/**
 * Batch processing type definitions for video generation
 */

import type { AspectRatio, Resolution, Model } from './tools.js';

/**
 * Individual job configuration in batch
 */
export interface BatchJobConfig {
  /** Text prompt describing the video to generate or edit instruction */
  prompt: string;
  /** Output file path (optional, auto-generated if not specified) */
  output_path?: string;
  /** Model to use (default: grok-imagine-video) */
  model?: Model;
  /** Video duration in seconds (1-15, default: 5) - not applicable for edits */
  duration?: number;
  /** Aspect ratio (default: 16:9) - not applicable for edits */
  aspect_ratio?: AspectRatio;
  /** Resolution (default: 720p) */
  resolution?: Resolution;

  // Image-to-video generation
  /** URL of source image for video generation */
  image_url?: string;
  /** Local image file path for video generation (auto-uploaded to R2) */
  image_path?: string;

  // Edit-specific options
  /** URL of source video for editing (max 8.7 seconds) */
  video_url?: string;
}

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts (0-5, default: 2) */
  max_retries?: number;
  /** Delay between retries in milliseconds (100-60000, default: 1000) */
  retry_delay_ms?: number;
  /** Error patterns to trigger retry (case-insensitive) */
  retry_on_errors?: string[];
}

/**
 * Batch configuration file structure
 */
export interface BatchConfig {
  /** Array of job configurations (required, 1-100 jobs) */
  jobs: BatchJobConfig[];
  /** Default output directory for generated videos */
  output_dir?: string;
  /** Maximum concurrent jobs (1-10, default: 2) */
  max_concurrent?: number;
  /** Timeout in milliseconds (default: 600000 = 10 minutes) */
  timeout?: number;
  /** Polling interval in milliseconds (default: 5000 = 5 seconds) */
  poll_interval?: number;
  /** Maximum polling attempts per job (default: 120) */
  max_poll_attempts?: number;
  /** Retry policy for failed jobs */
  retry_policy?: RetryPolicy;
  /** Default model for all jobs */
  default_model?: Model;
  /** Default resolution for all jobs */
  default_resolution?: Resolution;
  /** Default aspect ratio for all jobs */
  default_aspect_ratio?: AspectRatio;
  /** Default duration in seconds for all jobs */
  default_duration?: number;
}

/**
 * Result of a single batch job
 */
export interface BatchJobResult {
  /** Job index (1-based) */
  index: number;
  /** Original prompt */
  prompt: string;
  /** Job status */
  status: 'completed' | 'failed' | 'cancelled';
  /** Output file path */
  output_path?: string;
  /** Video URL from API */
  video_url?: string;
  /** Error message if failed */
  error?: string;
  /** Job duration in milliseconds (including polling time) */
  duration_ms?: number;
  /** Video duration in seconds */
  video_duration?: number;
  /** Whether this was an edit job */
  is_edit?: boolean;
  /** Whether this was an image-to-video job */
  is_image_to_video?: boolean;
  /** Request ID from API */
  request_id?: string;
}

/**
 * Overall batch execution result
 */
export interface BatchResult {
  /** Total number of jobs */
  total: number;
  /** Number of successful jobs */
  succeeded: number;
  /** Number of failed jobs */
  failed: number;
  /** Number of cancelled jobs (timeout) */
  cancelled: number;
  /** Individual job results */
  results: BatchJobResult[];
  /** Batch start timestamp (ISO) */
  started_at: string;
  /** Batch finish timestamp (ISO) */
  finished_at: string;
  /** Total batch duration in milliseconds */
  total_duration_ms: number;
  /** Estimated total cost in USD */
  estimated_cost?: number;
}

/**
 * Batch execution options (from CLI)
 */
export interface BatchExecutionOptions {
  /** Override output directory */
  outputDir?: string;
  /** Output format */
  format?: 'text' | 'json';
  /** Timeout in milliseconds */
  timeout?: number;
  /** Maximum concurrent jobs */
  maxConcurrent?: number;
  /** Polling interval in milliseconds */
  pollInterval?: number;
  /** Maximum polling attempts per job */
  maxPollAttempts?: number;
  /** Estimate cost only without executing */
  estimateOnly?: boolean;
  /** Allow any output path (for CI/CD) */
  allowAnyPath?: boolean;
}

/**
 * Cost estimation result
 */
export interface CostEstimate {
  totalJobs: number;
  totalVideoDuration: number; // Total seconds of video
  estimatedCostMin: number;
  estimatedCostMax: number;
  breakdown: {
    type: 'generation' | 'image_to_video' | 'edit';
    count: number;
    totalDuration: number;
    costMin: number;
    costMax: number;
  }[];
}
