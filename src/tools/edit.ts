/**
 * Edit video tool - Edit videos using xAI Grok Imagine Video
 * Uses /v1/videos/edits endpoint
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { runVideoJob, formatVideoResult } from '../utils/video.js';
import {
  normalizeAndValidatePath,
  generateUniqueFilePath,
} from '../utils/path.js';
import { debugLog } from '../utils/debug.js';
import type {
  EditVideoParams,
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
    video_file_id,
    output_path = 'edited_video.mp4',
    model = 'grok-imagine-video',
  } = params;

  // Validate video source (URL or Files API ID, exactly one)
  if (!video_url && !video_file_id) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Either video_url or video_file_id is required for video editing'
    );
  }
  if (video_url && video_file_id) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Specify only one of video_url or video_file_id.'
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
      video: video_file_id ? { file_id: video_file_id } : { url: video_url },
    };

    debugLog('Request body:', requestBody);

    return await runVideoJob(
      XAI_EDIT_ENDPOINT,
      apiKey,
      requestBody,
      normalizedPath,
      pollInterval,
      maxPollAttempts
    );
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
  let text = formatVideoResult(result, { action: 'editing', verb: 'edited' });
  if (result.success) {
    text += `\n\nNote: The edited video has the same duration as the original video (max ${MAX_EDIT_VIDEO_DURATION} seconds).`;
  }
  return text;
}
