/**
 * Type definitions for Grok Imagine Video MCP Server
 */

// Supported models
export const MODELS = ['grok-imagine-video'] as const;

export type Model = (typeof MODELS)[number];

// Supported aspect ratios for video generation (7 options)
export const ASPECT_RATIOS = [
  '16:9',
  '4:3',
  '1:1',
  '9:16',
  '3:4',
  '3:2',
  '2:3',
] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

// Supported resolutions
export const RESOLUTIONS = ['720p', '480p'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

// Duration constraints
export const MIN_DURATION = 1;
export const MAX_DURATION = 15;
export const MAX_EDIT_VIDEO_DURATION = 8.7; // seconds

// Default values
export const DEFAULT_DURATION = 5;
export const DEFAULT_RESOLUTION: Resolution = '720p';
export const DEFAULT_ASPECT_RATIO: AspectRatio = '16:9';

// Polling configuration defaults
export const DEFAULT_POLL_INTERVAL = 5000; // 5 seconds
export const DEFAULT_MAX_POLL_ATTEMPTS = 120; // 10 minutes with 5s interval

export interface GenerateVideoParams {
  /** Text prompt describing the video to generate */
  prompt: string;
  /** Output file path (optional, default: generated_video.mp4) */
  output_path?: string;
  /** Model to use (default: grok-imagine-video) */
  model?: Model;
  /** Video duration in seconds (1-15, default: 5) */
  duration?: number;
  /** Aspect ratio (default: 16:9) */
  aspect_ratio?: AspectRatio;
  /** Resolution (default: 720p) */
  resolution?: Resolution;
  /** Source image URL for image-to-video generation */
  image_url?: string;
}

export interface EditVideoParams {
  /** Text prompt describing the edit to apply */
  prompt: string;
  /** Source video URL (max 8.7 seconds) */
  video_url: string;
  /** Output file path (optional, default: edited_video.mp4) */
  output_path?: string;
  /** Model to use (default: grok-imagine-video) */
  model?: Model;
  // Note: duration is inherited from source video, aspect_ratio not configurable for edits
}

/**
 * Initial response from video generation/edit API
 */
export interface XAIVideoGenerationRequest {
  request_id: string;
}

/**
 * Video generation status
 */
export type VideoGenerationStatus = 'pending' | 'completed' | 'failed';

/**
 * Response from polling video generation result
 *
 * API returns different formats:
 * - Pending: { "status": "pending" }
 * - Completed: { "video": { "url": "...", "duration": 5 }, "model": "..." }
 * - Failed: { "status": "failed", "error": "..." }
 */
export interface XAIVideoGenerationResult {
  /** Status field (only present when pending or failed) */
  status?: VideoGenerationStatus;
  /** Video object (present when completed) */
  video?: {
    url: string;
    duration: number;
    respect_moderation?: boolean;
  };
  /** Model name (present when completed) */
  model?: string;
  /** Error message (available when status is 'failed') */
  error?: string;
}

export interface XAIErrorResponse {
  error?: {
    message: string;
    type?: string;
    code?: string;
  };
}

/**
 * Internal video generation result
 */
export interface VideoGenerationResult {
  /** Whether generation was successful */
  success: boolean;
  /** Video URL */
  url?: string;
  /** Local file path where video was saved */
  output_path?: string;
  /** Video duration in seconds */
  duration?: number;
  /** Error message if failed */
  error?: string;
  /** Request ID from API */
  request_id?: string;
}
