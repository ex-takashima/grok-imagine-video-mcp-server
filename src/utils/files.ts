/**
 * xAI Files API integration (upload local files, get a file_id usable as
 * image/video input for Imagine endpoints)
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { stat, readFile } from 'fs/promises';
import { basename, extname } from 'path';
import { debugLog } from './debug.js';
import { extractApiErrorMessage } from './video.js';
import { MAX_UPLOAD_FILE_BYTES } from '../types/tools.js';

const XAI_FILES_ENDPOINT = 'https://api.x.ai/v1/files';

// Image formats we can label correctly. Unlike the old R2 flow (where xAI
// fetched raw bytes from a URL and could content-sniff them), the MIME type
// declared here travels with the payload (data URL or Files API upload), so
// unknown extensions must be rejected client-side instead of guessing.
export const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

// Video formats accepted as Imagine input via the Files API (per official docs: MP4)
export const VIDEO_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
};

/**
 * Get MIME type for image files
 */
export function getImageMimeType(filePath: string): string {
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
 * Get MIME type for any file uploadable as Imagine input (image or video)
 */
export function getUploadMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES[ext] || VIDEO_MIME_TYPES[ext];
  if (!mimeType) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unsupported file format "${ext || '(no extension)'}": ${filePath}. ` +
        `Supported extensions: ${[...Object.keys(IMAGE_MIME_TYPES), ...Object.keys(VIDEO_MIME_TYPES)].join(', ')}`
    );
  }
  return mimeType;
}

export interface UploadedFile {
  file_id: string;
  filename: string;
  bytes: number;
}

/**
 * Upload a local file to the xAI Files API and return its file_id.
 * The stored file stays private; Imagine endpoints fetch it server-side.
 */
export async function uploadFileToXai(
  apiKey: string,
  filePath: string,
  mimeType: string
): Promise<UploadedFile> {
  let fileSize: number;
  try {
    fileSize = (await stat(filePath)).size;
  } catch {
    throw new McpError(ErrorCode.InvalidParams, `File not found: ${filePath}`);
  }

  if (fileSize > MAX_UPLOAD_FILE_BYTES) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `File too large: ${filePath} (${(fileSize / (1024 * 1024)).toFixed(1)} MB). ` +
        `The xAI Files API accepts up to ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024)} MB per file.`
    );
  }

  debugLog('Uploading file to xAI Files API:', { filePath, fileSize, mimeType });

  const fileBuffer = await readFile(filePath);
  const form = new FormData();
  form.append('purpose', 'assistants');
  form.append('file', new Blob([fileBuffer], { type: mimeType }), basename(filePath));

  const response = await fetch(XAI_FILES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
    body: form,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage =
      extractApiErrorMessage(errorData) ||
      `HTTP ${response.status}: ${response.statusText}`;
    throw new McpError(
      ErrorCode.InternalError,
      `File upload failed (${response.status}): ${errorMessage}`
    );
  }

  const data = (await response.json()) as { id?: string; filename?: string; bytes?: number };

  if (!data.id) {
    throw new McpError(ErrorCode.InternalError, 'No file id returned from Files API');
  }

  debugLog('File uploaded:', data);

  return {
    file_id: data.id,
    filename: data.filename ?? basename(filePath),
    bytes: data.bytes ?? fileSize,
  };
}

/**
 * Upload a local video file (MP4) and return a { file_id } video source
 * usable by the edit/extend endpoints.
 */
export async function resolveLocalVideo(
  apiKey: string,
  videoPath: string
): Promise<{ file_id: string }> {
  const ext = extname(videoPath).toLowerCase();
  const mimeType = VIDEO_MIME_TYPES[ext];
  if (!mimeType) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unsupported video format "${ext || '(no extension)'}": ${videoPath}. ` +
        `Supported extensions: ${Object.keys(VIDEO_MIME_TYPES).join(', ')}`
    );
  }

  const uploaded = await uploadFileToXai(apiKey, videoPath, mimeType);
  return { file_id: uploaded.file_id };
}
