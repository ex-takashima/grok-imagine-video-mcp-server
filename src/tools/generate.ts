/**
 * Generate video tool - Create videos from text prompts or images using xAI Grok Imagine Video
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
  GenerateVideoParams,
  XAIVideoGenerationRequest,
  VideoGenerationResult,
} from '../types/tools.js';
import {
  ASPECT_RATIOS,
  RESOLUTIONS,
  MODELS,
  MIN_DURATION,
  MAX_DURATION,
  DEFAULT_DURATION,
  DEFAULT_RESOLUTION,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
} from '../types/tools.js';

const XAI_API_ENDPOINT = 'https://api.x.ai/v1/videos/generations';

export async function generateVideo(
  apiKey: string,
  params: GenerateVideoParams,
  pollInterval: number = DEFAULT_POLL_INTERVAL,
  maxPollAttempts: number = DEFAULT_MAX_POLL_ATTEMPTS
): Promise<VideoGenerationResult> {
  debugLog('Generate video called with params:', params);

  const {
    prompt,
    output_path = 'generated_video.mp4',
    model = 'grok-imagine-video',
    duration = DEFAULT_DURATION,
    aspect_ratio = DEFAULT_ASPECT_RATIO,
    resolution = DEFAULT_RESOLUTION,
    image_url,
  } = params;

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

  if (duration < MIN_DURATION || duration > MAX_DURATION) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid duration: ${duration}. Must be between ${MIN_DURATION} and ${MAX_DURATION} seconds`
    );
  }

  if (!ASPECT_RATIOS.includes(aspect_ratio as any)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid aspect_ratio: ${aspect_ratio}. Must be one of: ${ASPECT_RATIOS.join(', ')}`
    );
  }

  if (!RESOLUTIONS.includes(resolution as any)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid resolution: ${resolution}. Must be one of: ${RESOLUTIONS.join(', ')}`
    );
  }

  try {
    debugLog('Calling xAI Video API...');

    // Build request body
    const requestBody: Record<string, any> = {
      model,
      prompt,
      duration,
      aspect_ratio,
      resolution,
    };

    // Add image for image-to-video generation
    if (image_url) {
      requestBody.image = { url: image_url };
      debugLog('Image-to-video mode with image URL');
    }

    debugLog('Request body:', requestBody);

    // Call xAI API to start video generation
    const response = await fetch(XAI_API_ENDPOINT, {
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

    debugLog('Video generation request accepted:', requestData);

    if (!requestData.request_id) {
      throw new McpError(ErrorCode.InternalError, 'No request_id returned from API');
    }

    // Poll for result
    debugLog('Starting polling for video result...');
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

    debugLog(`Video saved to: ${displayPath}`);

    return {
      success: true,
      url: result.video.url,
      output_path: normalizedPath,
      duration: result.video.duration,
      request_id: requestData.request_id,
    };
  } catch (error: any) {
    debugLog('Error generating video:', error);

    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Failed to generate video: ${error.message}`
    );
  }
}

/**
 * Format result for MCP response
 */
export function formatGenerateResult(result: VideoGenerationResult): string {
  if (!result.success) {
    return `Video generation failed: ${result.error}`;
  }

  const displayPath = result.output_path ? getDisplayPath(result.output_path) : 'unknown';

  let text = `Video generated successfully: ${displayPath}`;
  text += `\n\nDetails:`;
  text += `\n  - Request ID: ${result.request_id}`;
  if (result.duration) {
    text += `\n  - Duration: ${result.duration} seconds`;
  }
  if (result.url) {
    text += `\n  - Video URL: ${result.url}`;
  }

  return text;
}
