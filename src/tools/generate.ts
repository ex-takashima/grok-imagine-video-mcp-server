/**
 * Generate video tool - Create videos from text prompts or images using xAI Grok Imagine Video
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { stat, readFile } from 'fs/promises';
import { extname } from 'path';
import { runVideoJob, formatVideoResult } from '../utils/video.js';
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

// Image formats we can label correctly in a data URL. Unlike the old R2 flow
// (where xAI fetched raw bytes from a URL and could content-sniff them), the
// MIME type declared here travels inside the payload, so unknown extensions
// must be rejected client-side instead of guessing.
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

/**
 * Get MIME type for image files
 */
function getImageMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES[ext];
  if (!mimeType) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unsupported image format "${ext || '(no extension)'}": ${filePath}. ` +
        `Supported extensions: ${Object.keys(IMAGE_MIME_TYPES).join(', ')}`
    );
  }
  return mimeType;
}

/**
 * Read a local image file and return it as a base64 data URL.
 */
async function imagePathToDataUrl(imagePath: string): Promise<string> {
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
    throw new McpError(
      ErrorCode.InvalidParams,
      `Image file too large: ${imagePath} (${(fileSize / (1024 * 1024)).toFixed(1)} MB). ` +
        `Local images are sent inline as base64; maximum is ${MAX_IMAGE_FILE_BYTES / (1024 * 1024)} MB. ` +
        `Use image_url with a hosted image for larger files.`
    );
  }

  debugLog('Reading local image for base64 encoding:', imagePath);
  const fileBuffer = await readFile(imagePath);
  const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
  debugLog('Image converted to data URL:', { mimeType, size: fileBuffer.length });
  return dataUrl;
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

  // Resolve final image URL (convert local file to base64 data URL if image_path is provided)
  let finalImageUrl = image_url;

  if (image_path) {
    finalImageUrl = await imagePathToDataUrl(image_path);
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
        resolvedReferenceImages.push({ url: await imagePathToDataUrl(ref.path) });
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
    if (image_file_id) {
      requestBody.image = { file_id: image_file_id };
      debugLog('Image-to-video mode enabled (file_id)');
    } else if (finalImageUrl) {
      requestBody.image = { url: finalImageUrl };
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
