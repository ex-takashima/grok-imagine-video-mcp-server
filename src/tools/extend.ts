/**
 * Extend video tool - Extend a video by generating continuation content
 * Uses /v1/videos/extensions endpoint (grok-imagine-video 1.5)
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { downloadAndSaveVideo, pollVideoResult, extractApiErrorMessage } from '../utils/video.js';
import {
  normalizeAndValidatePath,
  getDisplayPath,
  generateUniqueFilePath,
} from '../utils/path.js';
import { debugLog } from '../utils/debug.js';
import type {
  ExtendVideoParams,
  XAIVideoGenerationRequest,
  VideoGenerationResult,
} from '../types/tools.js';
import {
  MODELS,
  MIN_EXTENSION_DURATION,
  MAX_EXTENSION_DURATION,
  DEFAULT_EXTENSION_DURATION,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
  ticksToUsd,
} from '../types/tools.js';

const XAI_EXTEND_ENDPOINT = 'https://api.x.ai/v1/videos/extensions';

export async function extendVideo(
  apiKey: string,
  params: ExtendVideoParams,
  pollInterval: number = DEFAULT_POLL_INTERVAL,
  maxPollAttempts: number = DEFAULT_MAX_POLL_ATTEMPTS
): Promise<VideoGenerationResult> {
  debugLog('Extend video called with params:', params);

  const {
    prompt,
    video_url,
    output_path = 'extended_video.mp4',
    model = 'grok-imagine-video',
    duration = DEFAULT_EXTENSION_DURATION,
  } = params;

  // Validation
  if (!prompt || prompt.trim().length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Prompt is required and cannot be empty for video extension'
    );
  }

  if (!video_url) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'video_url is required for video extension'
    );
  }

  if (!MODELS.includes(model as any)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid model: ${model}. Must be one of: ${MODELS.join(', ')}`
    );
  }

  if (duration < MIN_EXTENSION_DURATION || duration > MAX_EXTENSION_DURATION) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid duration: ${duration}. Extension duration must be between ${MIN_EXTENSION_DURATION} and ${MAX_EXTENSION_DURATION} seconds`
    );
  }

  // Normalize and validate output path
  let normalizedPath = await normalizeAndValidatePath(output_path);
  normalizedPath = await generateUniqueFilePath(normalizedPath);

  try {
    debugLog('Calling xAI Video Extension API...');

    // Build request body according to /v1/videos/extensions spec
    const requestBody: Record<string, any> = {
      model,
      prompt,
      duration,
      video: {
        url: video_url,
      },
    };

    debugLog('Request body:', requestBody);

    const response = await fetch(XAI_EXTEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
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
      } else if (response.status === 403) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Access denied. Please check your API key permissions.'
        );
      } else if (response.status === 400) {
        throw new McpError(ErrorCode.InvalidRequest, `Bad request: ${errorMessage}`);
      } else if (response.status === 429) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Rate limit exceeded. Please wait and try again.'
        );
      } else {
        throw new McpError(
          ErrorCode.InternalError,
          `API error (${response.status}): ${errorMessage}`
        );
      }
    }

    const requestData = (await response.json()) as XAIVideoGenerationRequest;

    debugLog('Video extension request accepted:', requestData);

    if (!requestData.request_id) {
      throw new McpError(ErrorCode.InternalError, 'No request_id returned from API');
    }

    // Poll for result
    debugLog('Starting polling for video extension result...');
    const result = await pollVideoResult(
      apiKey,
      requestData.request_id,
      pollInterval,
      maxPollAttempts
    );

    if (!result.video?.url) {
      throw new McpError(ErrorCode.InternalError, 'No video URL in completed response');
    }

    // Download and save video
    await downloadAndSaveVideo(result.video.url, normalizedPath);

    const displayPath = getDisplayPath(normalizedPath);

    debugLog(`Extended video saved to: ${displayPath}`);

    return {
      success: true,
      url: result.video.url,
      output_path: normalizedPath,
      duration: result.video.duration,
      request_id: requestData.request_id,
      cost_in_usd_ticks: result.usage?.cost_in_usd_ticks,
    };
  } catch (error: any) {
    debugLog('Error extending video:', error);

    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Failed to extend video: ${error.message}`
    );
  }
}

/**
 * Format result for MCP response
 */
export function formatExtendResult(result: VideoGenerationResult): string {
  if (!result.success) {
    return `Video extension failed: ${result.error}`;
  }

  const displayPath = result.output_path ? getDisplayPath(result.output_path) : 'unknown';

  let text = `Video extended successfully: ${displayPath}`;
  text += `\n\nDetails:`;
  text += `\n  - Request ID: ${result.request_id}`;
  if (result.duration) {
    text += `\n  - Total duration: ${result.duration} seconds`;
  }
  if (result.cost_in_usd_ticks !== undefined) {
    text += `\n  - Cost: $${ticksToUsd(result.cost_in_usd_ticks).toFixed(4)}`;
  }
  if (result.url) {
    text += `\n  - Video URL: ${result.url}`;
  }

  return text;
}
