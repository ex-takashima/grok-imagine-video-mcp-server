/**
 * Batch configuration loading and validation for video generation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  BatchConfig,
  BatchJobConfig,
  RetryPolicy,
  BatchExecutionOptions,
} from '../types/batch.js';
import {
  MODELS,
  ASPECT_RATIOS,
  RESOLUTIONS,
  MIN_DURATION,
  MAX_DURATION,
  MAX_EDIT_VIDEO_DURATION,
  DEFAULT_DURATION,
  DEFAULT_RESOLUTION,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
} from '../types/tools.js';

/**
 * Custom error for batch configuration issues
 */
export class BatchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchConfigError';
  }
}

/**
 * Load and parse batch configuration from JSON file
 */
export async function loadBatchConfig(configPath: string): Promise<BatchConfig> {
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.join(process.cwd(), configPath);

  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    const config = JSON.parse(content) as BatchConfig;
    return config;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new BatchConfigError(`Configuration file not found: ${configPath}`);
    }
    if (error instanceof SyntaxError) {
      throw new BatchConfigError(`Invalid JSON in configuration file: ${error.message}`);
    }
    throw new BatchConfigError(`Failed to load configuration: ${error.message}`);
  }
}

/**
 * Validate batch configuration
 */
export function validateBatchConfig(config: BatchConfig): void {
  // Validate jobs array
  if (!config.jobs || !Array.isArray(config.jobs)) {
    throw new BatchConfigError('Configuration must have a "jobs" array');
  }

  if (config.jobs.length === 0) {
    throw new BatchConfigError('Jobs array cannot be empty');
  }

  if (config.jobs.length > 100) {
    throw new BatchConfigError('Maximum 100 jobs allowed per batch');
  }

  // Validate each job
  config.jobs.forEach((job, index) => {
    validateJobConfig(job, index);
  });

  // Validate max_concurrent
  if (config.max_concurrent !== undefined) {
    if (
      typeof config.max_concurrent !== 'number' ||
      config.max_concurrent < 1 ||
      config.max_concurrent > 10
    ) {
      throw new BatchConfigError('max_concurrent must be a number between 1 and 10');
    }
  }

  // Validate timeout
  if (config.timeout !== undefined) {
    if (
      typeof config.timeout !== 'number' ||
      config.timeout < 1000 ||
      config.timeout > 3600000
    ) {
      throw new BatchConfigError('timeout must be between 1000 and 3600000 milliseconds');
    }
  }

  // Validate poll_interval
  if (config.poll_interval !== undefined) {
    if (
      typeof config.poll_interval !== 'number' ||
      config.poll_interval < 1000 ||
      config.poll_interval > 60000
    ) {
      throw new BatchConfigError('poll_interval must be between 1000 and 60000 milliseconds');
    }
  }

  // Validate max_poll_attempts
  if (config.max_poll_attempts !== undefined) {
    if (
      typeof config.max_poll_attempts !== 'number' ||
      config.max_poll_attempts < 1 ||
      config.max_poll_attempts > 1000
    ) {
      throw new BatchConfigError('max_poll_attempts must be between 1 and 1000');
    }
  }

  // Validate retry_policy
  if (config.retry_policy) {
    validateRetryPolicy(config.retry_policy);
  }

  // Validate default_model
  if (config.default_model !== undefined) {
    if (!MODELS.includes(config.default_model as any)) {
      throw new BatchConfigError(
        `Invalid default_model: ${config.default_model}. Must be one of: ${MODELS.join(', ')}`
      );
    }
  }

  // Validate default_resolution
  if (config.default_resolution !== undefined) {
    if (!RESOLUTIONS.includes(config.default_resolution as any)) {
      throw new BatchConfigError(
        `Invalid default_resolution: ${config.default_resolution}. Must be one of: ${RESOLUTIONS.join(', ')}`
      );
    }
  }

  // Validate default_aspect_ratio
  if (config.default_aspect_ratio !== undefined) {
    if (!ASPECT_RATIOS.includes(config.default_aspect_ratio as any)) {
      throw new BatchConfigError(
        `Invalid default_aspect_ratio: ${config.default_aspect_ratio}. Must be one of: ${ASPECT_RATIOS.join(', ')}`
      );
    }
  }

  // Validate default_duration
  if (config.default_duration !== undefined) {
    if (
      typeof config.default_duration !== 'number' ||
      config.default_duration < MIN_DURATION ||
      config.default_duration > MAX_DURATION
    ) {
      throw new BatchConfigError(
        `default_duration must be between ${MIN_DURATION} and ${MAX_DURATION} seconds`
      );
    }
  }
}

/**
 * Validate individual job configuration
 */
function validateJobConfig(job: BatchJobConfig, index: number): void {
  const prefix = `Job ${index + 1}`;

  // Validate prompt
  if (!job.prompt || typeof job.prompt !== 'string' || job.prompt.trim().length === 0) {
    throw new BatchConfigError(`${prefix}: prompt is required and must be a non-empty string`);
  }

  // Validate model
  if (job.model !== undefined) {
    if (!MODELS.includes(job.model as any)) {
      throw new BatchConfigError(
        `${prefix}: Invalid model "${job.model}". Must be one of: ${MODELS.join(', ')}`
      );
    }
  }

  // Determine job type
  const isEditJob = !!job.video_url;
  const isImageToVideoJob = !!job.image_url;

  // Validate duration
  if (job.duration !== undefined) {
    if (isEditJob) {
      throw new BatchConfigError(
        `${prefix}: duration cannot be specified for edit jobs (inherited from source video)`
      );
    }
    if (
      typeof job.duration !== 'number' ||
      job.duration < MIN_DURATION ||
      job.duration > MAX_DURATION
    ) {
      throw new BatchConfigError(
        `${prefix}: duration must be between ${MIN_DURATION} and ${MAX_DURATION} seconds`
      );
    }
  }

  // Validate aspect_ratio
  if (job.aspect_ratio !== undefined) {
    if (isEditJob) {
      throw new BatchConfigError(
        `${prefix}: aspect_ratio cannot be specified for edit jobs`
      );
    }
    if (!ASPECT_RATIOS.includes(job.aspect_ratio as any)) {
      throw new BatchConfigError(
        `${prefix}: Invalid aspect_ratio "${job.aspect_ratio}". Must be one of: ${ASPECT_RATIOS.join(', ')}`
      );
    }
  }

  // Validate resolution
  if (job.resolution !== undefined) {
    if (!RESOLUTIONS.includes(job.resolution as any)) {
      throw new BatchConfigError(
        `${prefix}: Invalid resolution "${job.resolution}". Must be one of: ${RESOLUTIONS.join(', ')}`
      );
    }
  }

  // Edit job requirements
  if (isEditJob) {
    // Cannot have both video_url and image_url
    if (isImageToVideoJob) {
      throw new BatchConfigError(
        `${prefix}: Cannot specify both video_url and image_url`
      );
    }
  }
}

/**
 * Validate retry policy
 */
function validateRetryPolicy(policy: RetryPolicy): void {
  if (policy.max_retries !== undefined) {
    if (
      typeof policy.max_retries !== 'number' ||
      policy.max_retries < 0 ||
      policy.max_retries > 5
    ) {
      throw new BatchConfigError('retry_policy.max_retries must be between 0 and 5');
    }
  }

  if (policy.retry_delay_ms !== undefined) {
    if (
      typeof policy.retry_delay_ms !== 'number' ||
      policy.retry_delay_ms < 100 ||
      policy.retry_delay_ms > 60000
    ) {
      throw new BatchConfigError(
        'retry_policy.retry_delay_ms must be between 100 and 60000'
      );
    }
  }

  if (policy.retry_on_errors !== undefined) {
    if (!Array.isArray(policy.retry_on_errors)) {
      throw new BatchConfigError('retry_policy.retry_on_errors must be an array');
    }
    if (!policy.retry_on_errors.every((e) => typeof e === 'string')) {
      throw new BatchConfigError('retry_policy.retry_on_errors must contain only strings');
    }
  }
}

/**
 * Merge batch configuration with CLI options and environment defaults
 */
export function mergeBatchConfig(
  config: BatchConfig,
  options: BatchExecutionOptions
): BatchConfig {
  const merged: BatchConfig = { ...config };

  // Apply environment defaults
  if (!merged.output_dir && process.env.OUTPUT_DIR) {
    merged.output_dir = process.env.OUTPUT_DIR;
  }

  // Apply CLI overrides
  if (options.outputDir) {
    merged.output_dir = options.outputDir;
  }

  if (options.maxConcurrent !== undefined) {
    merged.max_concurrent = options.maxConcurrent;
  }

  if (options.timeout !== undefined) {
    merged.timeout = options.timeout;
  }

  if (options.pollInterval !== undefined) {
    merged.poll_interval = options.pollInterval;
  }

  if (options.maxPollAttempts !== undefined) {
    merged.max_poll_attempts = options.maxPollAttempts;
  }

  // Set defaults
  merged.max_concurrent = merged.max_concurrent ?? 2;
  merged.timeout = merged.timeout ?? 600000; // 10 minutes
  merged.poll_interval = merged.poll_interval ?? DEFAULT_POLL_INTERVAL;
  merged.max_poll_attempts = merged.max_poll_attempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  merged.default_model = merged.default_model ?? 'grok-imagine-video';
  merged.default_resolution = merged.default_resolution ?? DEFAULT_RESOLUTION;
  merged.default_aspect_ratio = merged.default_aspect_ratio ?? DEFAULT_ASPECT_RATIO;
  merged.default_duration = merged.default_duration ?? DEFAULT_DURATION;

  // Default retry policy
  merged.retry_policy = merged.retry_policy ?? {
    max_retries: 2,
    retry_delay_ms: 1000,
    retry_on_errors: ['rate_limit', 'timeout', '429', '503'],
  };

  return merged;
}

/**
 * Get default output directory
 */
export function getDefaultOutputDirectory(): string {
  return process.env.OUTPUT_DIR || process.cwd();
}

/**
 * Resolve output path for a job
 */
export function resolveOutputPath(
  job: BatchJobConfig,
  index: number,
  outputDir: string,
  allowAnyPath: boolean = false
): string {
  let outputPath: string;

  if (job.output_path) {
    if (path.isAbsolute(job.output_path)) {
      if (!allowAnyPath) {
        // Security check: ensure path is within allowed directory
        const resolved = path.resolve(job.output_path);
        const allowedDir = path.resolve(outputDir);
        if (!resolved.startsWith(allowedDir)) {
          throw new BatchConfigError(
            `Job ${index + 1}: Output path must be within output directory. Use --allow-any-path to override.`
          );
        }
      }
      outputPath = job.output_path;
    } else {
      outputPath = path.join(outputDir, job.output_path);
    }
  } else {
    // Generate default filename
    const isEditJob = !!job.video_url;
    const isImageToVideoJob = !!job.image_url;
    let prefix: string;
    if (isEditJob) {
      prefix = 'edited';
    } else if (isImageToVideoJob) {
      prefix = 'animated';
    } else {
      prefix = 'generated';
    }
    outputPath = path.join(outputDir, `${prefix}_${index + 1}.mp4`);
  }

  return outputPath;
}
