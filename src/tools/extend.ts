/**
 * Extend video tool - Extend a video by generating continuation content
 * Uses /v1/videos/extensions endpoint (grok-imagine-video 1.5)
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { runVideoJob, formatVideoResult } from '../utils/video.js';
import {
  normalizeAndValidatePath,
  generateUniqueFilePath,
} from '../utils/path.js';
import { debugLog } from '../utils/debug.js';
import type {
  ExtendVideoParams,
  VideoGenerationResult,
} from '../types/tools.js';
import {
  MODELS,
  MIN_EXTENSION_DURATION,
  MAX_EXTENSION_DURATION,
  DEFAULT_EXTENSION_DURATION,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
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
    video_file_id,
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

  // Validate video source (URL or Files API ID, exactly one)
  if (!video_url && !video_file_id) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Either video_url or video_file_id is required for video extension'
    );
  }
  if (video_url && video_file_id) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Specify only one of video_url or video_file_id.'
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
      video: video_file_id ? { file_id: video_file_id } : { url: video_url },
    };

    debugLog('Request body:', requestBody);

    return await runVideoJob(
      XAI_EXTEND_ENDPOINT,
      apiKey,
      requestBody,
      normalizedPath,
      pollInterval,
      maxPollAttempts
    );
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
  return formatVideoResult(result, {
    action: 'extension',
    verb: 'extended',
    durationLabel: 'Total duration',
  });
}
