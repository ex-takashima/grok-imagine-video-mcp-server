/**
 * Video utilities for downloading and processing videos
 */

import * as fs from 'fs/promises';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { debugLog } from './debug.js';
import { getDisplayPath } from './path.js';
import type {
  XAIVideoGenerationResult,
  XAIVideoGenerationRequest,
  VideoGenerationResult,
  VideoGenerationStatus,
  XAIVideoError,
} from '../types/tools.js';
import {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
  ticksToUsd,
} from '../types/tools.js';

/**
 * Extract a human-readable message from the polling error field.
 * Supports both the legacy string form and the 1.5 structured object form.
 */
export function extractVideoErrorMessage(
  error: string | XAIVideoError | undefined
): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error.message) {
    return error.code ? `${error.message} (${error.code})` : error.message;
  }
  return 'Unknown error';
}

/**
 * Extract a human-readable message from a non-OK HTTP response body.
 * Handles `{ error: "string" }`, `{ error: { message, code } }`, and `{ message }`.
 */
export function extractApiErrorMessage(body: any): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const err = body.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && err.message) {
    return err.code ? `${err.message} (${err.code})` : err.message;
  }
  if (typeof body.message === 'string') return body.message;
  return undefined;
}

/**
 * Download video from URL and save to file
 */
export async function downloadAndSaveVideo(
  url: string,
  outputPath: string
): Promise<void> {
  debugLog(`Downloading video from: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await fs.writeFile(outputPath, buffer);
  debugLog(`Saved video to: ${outputPath}`);
}

/**
 * Poll for video generation result
 */
export async function pollVideoResult(
  apiKey: string,
  requestId: string,
  pollInterval: number = DEFAULT_POLL_INTERVAL,
  maxAttempts: number = DEFAULT_MAX_POLL_ATTEMPTS,
  onProgress?: (
    status: VideoGenerationStatus,
    attempt: number,
    progress?: number
  ) => void
): Promise<XAIVideoGenerationResult> {
  debugLog(`Starting poll for request: ${requestId}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    debugLog(`Poll attempt ${attempt}/${maxAttempts}`);

    const response = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      debugLog(`Poll request failed: ${response.status}`, errorText);

      // Don't throw immediately for transient errors (5xx and 429 rate limits)
      if ((response.status >= 500 || response.status === 429) && attempt < maxAttempts) {
        debugLog(`Transient poll error (${response.status}), will retry...`);
        await sleep(pollInterval);
        continue;
      }

      // Surface the response body when available; xAI returns { code, error } or { error: { message } }
      let bodyMessage: string | undefined;
      try {
        bodyMessage = extractApiErrorMessage(JSON.parse(errorText));
      } catch {
        bodyMessage = errorText || undefined;
      }
      const detail = bodyMessage ? `: ${bodyMessage}` : '';
      throw new Error(
        `Failed to get video status: ${response.status} ${response.statusText}${detail}`
      );
    }

    const result = await response.json() as XAIVideoGenerationResult;
    debugLog(`Poll response: ${JSON.stringify(result)}`);

    // Check if video is ready (video URL present = completed)
    if (result.video && result.video.url) {
      debugLog(`Video generation completed: ${result.video.url}`);
      if (onProgress) {
        onProgress('done', attempt, 100);
      }
      return result;
    }

    // Check for failure (1.5 returns a structured error object; legacy returns a string)
    if (result.status === 'failed') {
      const message = extractVideoErrorMessage(result.error);
      debugLog(`Video generation failed: ${message}`);
      throw new Error(`Video generation failed: ${message}`);
    }

    // Terminal status but no URL: typically blocked by content moderation.
    // 1.5 reports 'done'; legacy responses use 'completed'.
    if (result.status === 'done' || result.status === 'completed') {
      if (result.video && result.video.respect_moderation === false) {
        throw new Error(
          'Video generation was blocked by content moderation (respect_moderation=false)'
        );
      }
      throw new Error('Video generation completed but no video URL was returned');
    }

    // Status is 'pending', continue polling
    const currentStatus = result.status || 'pending';
    debugLog(
      `Poll result status: ${currentStatus}` +
        (result.progress !== undefined ? ` (${result.progress}%)` : '')
    );

    if (onProgress) {
      onProgress(currentStatus, attempt, result.progress);
    }

    if (attempt < maxAttempts) {
      await sleep(pollInterval);
    }
  }

  throw new Error(`Video generation timed out after ${maxAttempts} attempts`);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Map a non-OK submit response to an McpError. Shared by generate/edit/extend.
 */
async function throwForApiError(response: Response): Promise<never> {
  const errorData = await response.json().catch(() => ({}));
  const errorMessage =
    extractApiErrorMessage(errorData) ||
    `HTTP ${response.status}: ${response.statusText}`;

  debugLog('API error:', errorData);

  if (response.status === 401) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Authentication failed. Please check your XAI_API_KEY environment variable.'
    );
  }
  if (response.status === 403) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Access denied. Please check your API key permissions.'
    );
  }
  if (response.status === 400) {
    throw new McpError(ErrorCode.InvalidRequest, `Bad request: ${errorMessage}`);
  }
  if (response.status === 429) {
    // "429" must stay in this message: batch retry_on_errors matches by substring
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Rate limit exceeded (429). Please wait and try again.'
    );
  }
  throw new McpError(
    ErrorCode.InternalError,
    `API error (${response.status}): ${errorMessage}`
  );
}

/**
 * Submit a video job, poll until done, download the MP4 to outputPath, and
 * return the normalized result. Shared pipeline for generate/edit/extend.
 */
export async function runVideoJob(
  endpoint: string,
  apiKey: string,
  requestBody: Record<string, any>,
  outputPath: string,
  pollInterval: number,
  maxPollAttempts: number
): Promise<VideoGenerationResult> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    await throwForApiError(response);
  }

  const requestData = (await response.json()) as XAIVideoGenerationRequest;
  debugLog('Video request accepted:', requestData);

  if (!requestData.request_id) {
    throw new McpError(ErrorCode.InternalError, 'No request_id returned from API');
  }

  const result = await pollVideoResult(
    apiKey,
    requestData.request_id,
    pollInterval,
    maxPollAttempts
  );

  if (!result.video?.url) {
    throw new McpError(ErrorCode.InternalError, 'No video URL in completed response');
  }

  await downloadAndSaveVideo(result.video.url, outputPath);
  debugLog(`Video saved to: ${getDisplayPath(outputPath)}`);

  return {
    success: true,
    url: result.video.url,
    output_path: outputPath,
    duration: result.video.duration,
    request_id: requestData.request_id,
    cost_in_usd_ticks: result.usage?.cost_in_usd_ticks,
  };
}

/**
 * Format a job result for MCP text output. Shared by generate/edit/extend.
 */
export function formatVideoResult(
  result: VideoGenerationResult,
  opts: { action: string; verb: string; durationLabel?: string }
): string {
  if (!result.success) {
    return `Video ${opts.action} failed: ${result.error}`;
  }

  const displayPath = result.output_path ? getDisplayPath(result.output_path) : 'unknown';

  let text = `Video ${opts.verb} successfully: ${displayPath}`;
  text += `\n\nDetails:`;
  text += `\n  - Request ID: ${result.request_id}`;
  if (result.duration) {
    text += `\n  - ${opts.durationLabel ?? 'Duration'}: ${result.duration} seconds`;
  }
  if (result.cost_in_usd_ticks !== undefined) {
    text += `\n  - Cost: $${ticksToUsd(result.cost_in_usd_ticks).toFixed(4)}`;
  }
  if (result.url) {
    text += `\n  - Video URL: ${result.url}`;
  }

  return text;
}

/**
 * Validate video URL accessibility
 */
export async function validateVideoUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Validate aspect ratio format
 */
export function validateAspectRatio(aspectRatio: string): boolean {
  // Format: "width:height" e.g., "4:3", "16:9", "1:1"
  const pattern = /^\d+:\d+$/;
  return pattern.test(aspectRatio);
}
