/**
 * Edit video tool - Edit videos using xAI Grok Imagine Video
 * Uses /v1/videos/edits endpoint
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { downloadAndSaveVideo, pollVideoResult } from '../utils/video.js';
import {
  normalizeAndValidatePath,
  getDisplayPath,
  generateUniqueFilePath,
} from '../utils/path.js';
import { debugLog } from '../utils/debug.js';
import type {
  EditVideoParams,
  XAIVideoGenerationRequest,
  VideoGenerationResult,
} from '../types/tools.js';
import {
  MODELS,
  MAX_EDIT_VIDEO_DURATION,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
} from '../types/tools.js';

const XAI_EDIT_ENDPOINT = 'https://api.x.ai/v1/videos/edits';

export async function editVideo(
  apiKey: string,
  params: EditVideoParams,
  pollInterval: number = DEFAULT_POLL_INTERVAL,
  maxPollAttempts: number = DEFAULT_MAX_POLL_ATTEMPTS
): Promise<VideoGenerationResult> {
  debugLog('Edit video called with params:', params);

  const {
    prompt,
    video_url,
    output_path = 'edited_video.mp4',
    model = 'grok-imagine-video',
  } = params;

  // Validate that video URL is provided
  if (!video_url) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'video_url is required for video editing'
    );
  }

  // Normalize and validate output path
  let normalizedPath = await normalizeAndValidatePath(output_path);
  normalizedPath = await generateUniqueFilePath(normalizedPath);

  // Validation
  if (!prompt || prompt.trim().length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Prompt is required and cannot be empty'
    );
  }

  if (!MODELS.includes(model as any)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid model: ${model}. Must be one of: ${MODELS.join(', ')}`
    );
  }

  try {
    debugLog('Calling xAI Video Edit API...');

    // Build request body according to /v1/videos/edits spec
    const requestBody: Record<string, any> = {
      model,
      prompt,
      video: {
        url: video_url,
      },
    };

    debugLog('Request body:', requestBody);

    // Call xAI Edit API
    const response = await fetch(XAI_EDIT_ENDPOINT, {
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
        errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;

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

    debugLog('Video edit request accepted:', requestData);

    if (!requestData.request_id) {
      throw new McpError(ErrorCode.InternalError, 'No request_id returned from API');
    }

    // Poll for result
    debugLog('Starting polling for video edit result...');
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

    debugLog(`Edited video saved to: ${displayPath}`);

    return {
      success: true,
      url: result.video.url,
      output_path: normalizedPath,
      duration: result.video.duration,
      request_id: requestData.request_id,
    };
  } catch (error: any) {
    debugLog('Error editing video:', error);

    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Failed to edit video: ${error.message}`
    );
  }
}

/**
 * Format result for MCP response
 */
export function formatEditResult(result: VideoGenerationResult): string {
  if (!result.success) {
    return `Video editing failed: ${result.error}`;
  }

  const displayPath = result.output_path ? getDisplayPath(result.output_path) : 'unknown';

  let text = `Video edited successfully: ${displayPath}`;
  text += `\n\nDetails:`;
  text += `\n  - Request ID: ${result.request_id}`;
  if (result.duration) {
    text += `\n  - Duration: ${result.duration} seconds`;
  }
  if (result.url) {
    text += `\n  - Video URL: ${result.url}`;
  }
  text += `\n\nNote: The edited video has the same duration as the original video (max ${MAX_EDIT_VIDEO_DURATION} seconds).`;

  return text;
}
