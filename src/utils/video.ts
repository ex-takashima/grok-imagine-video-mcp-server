/**
 * Video utilities for downloading and processing videos
 */

import * as fs from 'fs/promises';
import { debugLog } from './debug.js';
import type {
  XAIVideoGenerationResult,
  VideoGenerationStatus,
} from '../types/tools.js';
import {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
} from '../types/tools.js';

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
  onProgress?: (status: VideoGenerationStatus, attempt: number) => void
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

      // Don't throw immediately for transient errors
      if (response.status >= 500 && attempt < maxAttempts) {
        debugLog(`Server error, will retry...`);
        await sleep(pollInterval);
        continue;
      }

      throw new Error(`Failed to get video status: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as XAIVideoGenerationResult;
    debugLog(`Poll result status: ${result.status}`);

    if (onProgress) {
      onProgress(result.status, attempt);
    }

    if (result.status === 'completed') {
      debugLog(`Video generation completed: ${result.url}`);
      return result;
    }

    if (result.status === 'failed') {
      debugLog(`Video generation failed: ${result.error}`);
      throw new Error(`Video generation failed: ${result.error || 'Unknown error'}`);
    }

    // Status is 'pending', continue polling
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
