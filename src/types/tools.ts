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

// Supported resolutions (1080p added in grok-imagine-video 1.5)
export const RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

// Duration constraints
export const MIN_DURATION = 1;
export const MAX_DURATION = 15;
export const MAX_EDIT_VIDEO_DURATION = 8.7; // seconds

// Video extension (/v1/videos/extensions) duration constraints
export const MIN_EXTENSION_DURATION = 1;
export const MAX_EXTENSION_DURATION = 10;
export const DEFAULT_EXTENSION_DURATION = 6;

// Default values
export const DEFAULT_DURATION = 8; // grok-imagine-video 1.5 default (was 5)
export const DEFAULT_RESOLUTION: Resolution = '720p';
export const DEFAULT_ASPECT_RATIO: AspectRatio = '16:9';

// Polling configuration defaults
export const DEFAULT_POLL_INTERVAL = 5000; // 5 seconds
export const DEFAULT_MAX_POLL_ATTEMPTS = 120; // 10 minutes with 5s interval

/**
 * Reference image input for reference-to-video (R2V) generation.
 * Provide either a `url` (public or base64 data URL), a local `path`
 * (converted to a base64 data URL), or a `file_id` from the xAI Files API.
 */
export interface ReferenceImageInput {
  /** Public URL or base64 data URL of the reference image */
  url?: string;
  /** Local image file path (converted to a base64 data URL) */
  path?: string;
  /** File ID from the xAI Files API (mutually exclusive with url/path) */
  file_id?: string;
}

export interface GenerateVideoParams {
  /**
   * Text prompt. Required for text-to-video (T2V) and reference-to-video (R2V).
   * Optional for image-to-video (I2V): when omitted, the model generates from the image alone.
   */
  prompt?: string;
  /** Output file path (optional, default: generated_video.mp4) */
  output_path?: string;
  /** Model to use (default: grok-imagine-video) */
  model?: Model;
  /** Video duration in seconds (1-15, default: 8) */
  duration?: number;
  /** Aspect ratio (default: 16:9) */
  aspect_ratio?: AspectRatio;
  /** Resolution (default: 720p) */
  resolution?: Resolution;
  /** Source image URL for image-to-video generation */
  image_url?: string;
  /** Local image file path for image-to-video generation (sent as base64 data URL) */
  image_path?: string;
  /** Reference images for reference-to-video (R2V) generation */
  reference_images?: ReferenceImageInput[];
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

export interface ExtendVideoParams {
  /** Prompt describing what should happen next in the video */
  prompt: string;
  /** Source video URL (public URL or base64 data URL, .mp4) */
  video_url: string;
  /** Output file path (optional, default: extended_video.mp4) */
  output_path?: string;
  /** Model to use (default: grok-imagine-video) */
  model?: Model;
  /** Duration of the extension segment in seconds (1-10, default: 6) */
  duration?: number;
}

/**
 * Initial response from video generation/edit API
 */
export interface XAIVideoGenerationRequest {
  request_id: string;
}

/**
 * Video generation status.
 * grok-imagine-video 1.5 reports "done" when ready; older responses used "completed".
 */
export type VideoGenerationStatus = 'pending' | 'done' | 'completed' | 'failed';

/**
 * Structured error returned by the polling endpoint (grok-imagine-video 1.5).
 * Older responses returned a plain string, which is still accepted.
 */
export interface XAIVideoError {
  code?:
    | 'invalid_argument'
    | 'permission_denied'
    | 'failed_precondition'
    | 'service_unavailable'
    | 'internal_error';
  message: string;
}

/**
 * Response from polling video generation result
 *
 * API returns different formats:
 * - Pending: { "status": "pending", "progress": 42 }
 * - Done:    { "status": "done", "video": { "url": "...", "duration": 8 }, "model": "..." }
 * - Failed:  { "status": "failed", "error": { "code": "...", "message": "..." } }
 */
export interface XAIVideoGenerationResult {
  /** Status field */
  status?: VideoGenerationStatus;
  /** Approximate completion percentage (0-100) while pending */
  progress?: number;
  /** Video object (present when done/completed) */
  video?: {
    url?: string;
    duration: number;
    respect_moderation?: boolean;
  };
  /** Model name (present when done) */
  model?: string;
  /** Usage/cost information (grok-imagine-video 1.5) */
  usage?: {
    /** Cost in USD ticks (1 USD = 10,000,000,000 ticks) */
    cost_in_usd_ticks: number;
  };
  /** Error (string in legacy responses, structured object in 1.5) */
  error?: string | XAIVideoError;
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
  /** Actual cost in USD ticks reported by the API (1 USD = 10,000,000,000 ticks) */
  cost_in_usd_ticks?: number;
}

/** Convert xAI USD ticks to a US dollar amount (1 USD = 10,000,000,000 ticks) */
export function ticksToUsd(ticks: number): number {
  return ticks / 10_000_000_000;
}
