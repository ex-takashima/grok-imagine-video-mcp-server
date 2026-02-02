/**
 * Batch execution manager with concurrency control for video generation
 */

import type {
  BatchConfig,
  BatchJobConfig,
  BatchResult,
  BatchJobResult,
  BatchExecutionOptions,
  CostEstimate,
} from '../types/batch.js';
import { resolveOutputPath, getDefaultOutputDirectory } from './batch-config.js';
import { generateVideo } from '../tools/generate.js';
import { editVideo } from '../tools/edit.js';
import { debugLog } from './debug.js';
import {
  DEFAULT_DURATION,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
} from '../types/tools.js';

/**
 * Semaphore for concurrency control
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

/**
 * Cost per second of video by operation type (estimated)
 * Note: These are placeholder values - actual pricing should be verified with xAI
 */
const VIDEO_COSTS = {
  generation: { perSecond: 0.05 },
  image_to_video: { perSecond: 0.05, imageBonus: 0.01 },
  edit: { perSecond: 0.07 },
};

/**
 * BatchManager handles batch execution with concurrency control
 */
export class BatchManager {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Estimate cost for batch execution
   */
  estimateBatchCost(config: BatchConfig): CostEstimate {
    const breakdown: CostEstimate['breakdown'] = [];
    const typeCounts: Record<string, { count: number; totalDuration: number }> = {
      generation: { count: 0, totalDuration: 0 },
      image_to_video: { count: 0, totalDuration: 0 },
      edit: { count: 0, totalDuration: 0 },
    };

    const defaultDuration = config.default_duration ?? DEFAULT_DURATION;

    for (const job of config.jobs) {
      const isEdit = !!job.video_url;
      const isImageToVideo = !!job.image_url || !!job.image_path;

      let type: 'generation' | 'image_to_video' | 'edit';
      let duration: number;

      if (isEdit) {
        type = 'edit';
        // Edit duration is unknown (comes from source video), estimate 5 seconds
        duration = 5;
      } else if (isImageToVideo) {
        type = 'image_to_video';
        duration = job.duration ?? defaultDuration;
      } else {
        type = 'generation';
        duration = job.duration ?? defaultDuration;
      }

      typeCounts[type].count++;
      typeCounts[type].totalDuration += duration;
    }

    let totalMin = 0;
    let totalMax = 0;
    let totalVideoDuration = 0;

    for (const [type, data] of Object.entries(typeCounts)) {
      if (data.count === 0) continue;

      const costs = VIDEO_COSTS[type as keyof typeof VIDEO_COSTS];
      let cost = costs.perSecond * data.totalDuration;

      if (type === 'image_to_video') {
        cost += (costs as any).imageBonus * data.count;
      }

      breakdown.push({
        type: type as 'generation' | 'image_to_video' | 'edit',
        count: data.count,
        totalDuration: data.totalDuration,
        costMin: cost,
        costMax: cost * 1.2, // 20% margin for estimation
      });

      totalMin += cost;
      totalMax += cost * 1.2;
      totalVideoDuration += data.totalDuration;
    }

    return {
      totalJobs: config.jobs.length,
      totalVideoDuration,
      estimatedCostMin: totalMin,
      estimatedCostMax: totalMax,
      breakdown,
    };
  }

  /**
   * Execute batch jobs with concurrency control
   */
  async executeBatch(
    config: BatchConfig,
    options: BatchExecutionOptions = {}
  ): Promise<BatchResult> {
    const startTime = Date.now();
    const startedAt = new Date().toISOString();

    const maxConcurrent = config.max_concurrent || 2;
    const timeout = config.timeout || 600000;
    const outputDir = config.output_dir || getDefaultOutputDirectory();
    const pollInterval = config.poll_interval || DEFAULT_POLL_INTERVAL;
    const maxPollAttempts = config.max_poll_attempts || DEFAULT_MAX_POLL_ATTEMPTS;
    const semaphore = new Semaphore(maxConcurrent);

    debugLog(`Starting batch execution: ${config.jobs.length} jobs, max concurrent: ${maxConcurrent}`);

    const results: BatchJobResult[] = [];
    const jobPromises: Promise<void>[] = [];

    // Create job promises
    for (let i = 0; i < config.jobs.length; i++) {
      const job = config.jobs[i];
      const outputPath = resolveOutputPath(job, i, outputDir, options.allowAnyPath);

      const jobPromise = (async () => {
        await semaphore.acquire();
        try {
          const result = await this.executeJob(job, i, outputPath, config, pollInterval, maxPollAttempts);
          results.push(result);
        } finally {
          semaphore.release();
        }
      })();

      jobPromises.push(jobPromise);
    }

    // Execute with timeout
    let timedOut = false;
    try {
      await Promise.race([
        Promise.all(jobPromises),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            timedOut = true;
            reject(new Error('Batch execution timed out'));
          }, timeout)
        ),
      ]);
    } catch (error: any) {
      if (timedOut) {
        debugLog('Batch timed out, waiting for in-progress jobs...');
        // Wait a bit for in-progress jobs to complete
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        throw error;
      }
    }

    // Mark incomplete jobs as cancelled
    const completedIndices = new Set(results.map((r) => r.index));
    for (let i = 0; i < config.jobs.length; i++) {
      if (!completedIndices.has(i + 1)) {
        results.push({
          index: i + 1,
          prompt: config.jobs[i].prompt,
          status: 'cancelled',
          error: 'Job cancelled due to timeout',
        });
      }
    }

    // Sort results by index
    results.sort((a, b) => a.index - b.index);

    const endTime = Date.now();
    const finishedAt = new Date().toISOString();

    // Calculate totals
    const succeeded = results.filter((r) => r.status === 'completed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const cancelled = results.filter((r) => r.status === 'cancelled').length;

    // Estimate cost
    const estimate = this.estimateBatchCost(config);

    return {
      total: config.jobs.length,
      succeeded,
      failed,
      cancelled,
      results,
      started_at: startedAt,
      finished_at: finishedAt,
      total_duration_ms: endTime - startTime,
      estimated_cost: estimate.estimatedCostMin,
    };
  }

  /**
   * Execute a single job with retry logic
   */
  private async executeJob(
    job: BatchJobConfig,
    index: number,
    outputPath: string,
    config: BatchConfig,
    pollInterval: number,
    maxPollAttempts: number
  ): Promise<BatchJobResult> {
    const jobIndex = index + 1;
    const isEditJob = !!job.video_url;
    const isImageToVideoJob = !!job.image_url || !!job.image_path;
    const retryPolicy = config.retry_policy || { max_retries: 2, retry_delay_ms: 1000 };
    const maxRetries = retryPolicy.max_retries ?? 2;
    const retryDelay = retryPolicy.retry_delay_ms ?? 1000;
    const retryPatterns = retryPolicy.retry_on_errors ?? ['rate_limit', 'timeout', '429', '503'];

    let lastError: string = '';
    const startTime = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        debugLog(`Job ${jobIndex}: Starting (attempt ${attempt + 1}/${maxRetries + 1})`);

        let result: any;
        let videoUrl: string | undefined;
        let videoDuration: number | undefined;
        let requestId: string | undefined;

        if (isEditJob) {
          // Edit job
          result = await editVideo(this.apiKey, {
            prompt: job.prompt,
            video_url: job.video_url!,
            output_path: outputPath,
            model: job.model || config.default_model,
          }, pollInterval, maxPollAttempts);
        } else {
          // Generate job (text-to-video or image-to-video)
          result = await generateVideo(this.apiKey, {
            prompt: job.prompt,
            output_path: outputPath,
            model: job.model || config.default_model,
            duration: job.duration || config.default_duration,
            aspect_ratio: job.aspect_ratio || config.default_aspect_ratio,
            resolution: job.resolution || config.default_resolution,
            image_url: job.image_url,
            image_path: job.image_path,
          }, pollInterval, maxPollAttempts);
        }

        // Parse result
        if (result && typeof result === 'object') {
          if (result.url) {
            videoUrl = result.url;
          }
          if (result.duration) {
            videoDuration = result.duration;
          }
          if (result.request_id) {
            requestId = result.request_id;
          }
          if (result.output_path) {
            outputPath = result.output_path;
          }
        }

        const duration = Date.now() - startTime;
        debugLog(`Job ${jobIndex}: Completed in ${duration}ms`);

        return {
          index: jobIndex,
          prompt: job.prompt,
          status: 'completed',
          output_path: outputPath,
          video_url: videoUrl,
          duration_ms: duration,
          video_duration: videoDuration,
          is_edit: isEditJob,
          is_image_to_video: isImageToVideoJob,
          request_id: requestId,
        };
      } catch (error: any) {
        lastError = error.message || String(error);
        debugLog(`Job ${jobIndex}: Failed (attempt ${attempt + 1}): ${lastError}`);

        // Check if we should retry
        const shouldRetry =
          attempt < maxRetries &&
          retryPatterns.some((pattern) =>
            lastError.toLowerCase().includes(pattern.toLowerCase())
          );

        if (shouldRetry) {
          debugLog(`Job ${jobIndex}: Retrying in ${retryDelay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }

    // All retries exhausted
    const duration = Date.now() - startTime;
    return {
      index: jobIndex,
      prompt: job.prompt,
      status: 'failed',
      error: lastError,
      duration_ms: duration,
      is_edit: isEditJob,
      is_image_to_video: isImageToVideoJob,
    };
  }
}
