/**
 * Generate video tool - Create videos from text prompts or images using xAI Grok Imagine Video
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { stat, readFile } from 'fs/promises';
import { runVideoJob, formatVideoResult } from '../utils/video.js';
import { uploadFileToXai, getImageMimeType } from '../utils/files.js';
import {
  normalizeAndValidatePath,
  generateUniqueFilePath,
} from '../utils/path.js';
import { debugLog } from '../utils/debug.js';
import type {
  GenerateVideoParams,
  VideoGenerationResult,
} from '../types/tools.js';
import {
  ASPECT_RATIOS,
  RESOLUTIONS,
  MODELS,
  MIN_DURATION,
  MAX_DURATION,
  MAX_IMAGE_FILE_BYTES,
  DEFAULT_DURATION,
  DEFAULT_RESOLUTION,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
} from '../types/tools.js';

const XAI_API_ENDPOINT = 'https://api.x.ai/v1/videos/generations';

/**
 * Resolve a local image file to an API image source: small files are inlined
 * as a base64 data URL; files above MAX_IMAGE_FILE_BYTES are uploaded to the
 * xAI Files API and referenced by file_id.
 */
async function resolveLocalImage(
  apiKey: string,
  imagePath: string
): Promise<{ url: string } | { file_id: string }> {
  const mimeType = getImageMimeType(imagePath);

  let fileSize: number;
  try {
    fileSize = (await stat(imagePath)).size;
  } catch {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Image file not found: ${imagePath}`
    );
  }

  if (fileSize > MAX_IMAGE_FILE_BYTES) {
    debugLog('Image exceeds inline base64 limit, uploading via Files API:', imagePath);
    const uploaded = await uploadFileToXai(apiKey, imagePath, mimeType);
    return { file_id: uploaded.file_id };
  }

  debugLog('Reading local image for base64 encoding:', imagePath);
  const fileBuffer = await readFile(imagePath);
  const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
  debugLog('Image converted to data URL:', { mimeType, size: fileBuffer.length });
  return { url: dataUrl };
}

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
    image_path,
    image_file_id,
    reference_images,
  } = params;

  const hasImage = !!image_url || !!image_path || !!image_file_id;
  const hasReferenceImages = !!reference_images && reference_images.length > 0;
  const hasPrompt = !!prompt && prompt.trim().length > 0;

  // Normalize and validate output path
  let normalizedPath = await normalizeAndValidatePath(output_path);
  normalizedPath = await generateUniqueFilePath(normalizedPath);

  // Validation: prompt is required for text-to-video (T2V) and reference-to-video (R2V),
  // but optional for image-to-video (I2V) where the image alone drives generation.
  if (!hasPrompt && !hasImage) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Prompt is required unless an image is provided (image-to-video)'
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

  // Validate image source mutual exclusivity (URL, local path, or Files API ID)
  const imageSourceCount = [image_url, image_path, image_file_id].filter(Boolean).length;
  if (imageSourceCount > 1) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Specify only one of image_url, image_path, or image_file_id.'
    );
  }

  // image (I2V) and reference_images (R2V) are different generation modes
  if (hasImage && hasReferenceImages) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Cannot specify both an image (image-to-video) and reference_images (reference-to-video).'
    );
  }

  // Resolve the I2V image source (URL, Files API ID, or local file)
  let imageSource: { url: string } | { file_id: string } | undefined;
  if (image_file_id) {
    imageSource = { file_id: image_file_id };
  } else if (image_path) {
    imageSource = await resolveLocalImage(apiKey, image_path);
  } else if (image_url) {
    imageSource = { url: image_url };
  }

  // Resolve reference images (R2V): each may be a url, a local path, or a file_id
  const resolvedReferenceImages: Array<Record<string, string>> = [];
  if (hasReferenceImages) {
    for (const ref of reference_images!) {
      if (ref.file_id) {
        resolvedReferenceImages.push({ file_id: ref.file_id });
      } else if (ref.url) {
        resolvedReferenceImages.push({ url: ref.url });
      } else if (ref.path) {
        resolvedReferenceImages.push(await resolveLocalImage(apiKey, ref.path));
      } else {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Each reference image must include a url, path, or file_id.'
        );
      }
    }
  }

  try {
    debugLog('Calling xAI Video API...');

    // Build request body
    const requestBody: Record<string, any> = {
      model,
      duration,
      aspect_ratio,
      resolution,
    };

    // Prompt is optional for I2V; include it whenever provided
    if (hasPrompt) {
      requestBody.prompt = prompt;
    }

    // Add image for image-to-video generation (URL/data URL or Files API ID)
    if (imageSource) {
      requestBody.image = imageSource;
      debugLog('Image-to-video mode enabled');
    }

    // Add reference images for reference-to-video generation
    if (resolvedReferenceImages.length > 0) {
      requestBody.reference_images = resolvedReferenceImages;
      debugLog(`Reference-to-video mode with ${resolvedReferenceImages.length} reference image(s)`);
    }

    return await runVideoJob(
      XAI_API_ENDPOINT,
      apiKey,
      requestBody,
      normalizedPath,
      pollInterval,
      maxPollAttempts
    );
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
  return formatVideoResult(result, { action: 'generation', verb: 'generated' });
}
