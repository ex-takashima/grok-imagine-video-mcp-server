/**
 * Cloudflare R2 upload utility for image-to-video generation
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import { debugLog } from './debug.js';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

export interface R2UploadResult {
  url: string;
  key: string;
}

/**
 * Get R2 configuration from environment variables
 */
export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl: publicUrl.replace(/\/$/, ''), // Remove trailing slash
  };
}

/**
 * Check if R2 is configured
 */
export function isR2Configured(): boolean {
  return getR2Config() !== null;
}

/**
 * Get missing R2 environment variables
 */
export function getMissingR2Vars(): string[] {
  const required = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_URL',
  ];

  return required.filter((varName) => !process.env[varName]);
}

/**
 * Get content type from file extension
 */
function getContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Generate unique key for uploaded file
 */
function generateUniqueKey(filePath: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const filename = basename(filePath);
  const ext = extname(filename);
  const name = filename.replace(ext, '');

  return `grok-video/${timestamp}-${random}-${name}${ext}`;
}

/**
 * Upload a local file to Cloudflare R2
 */
export async function uploadToR2(filePath: string): Promise<R2UploadResult> {
  const config = getR2Config();

  if (!config) {
    const missing = getMissingR2Vars();
    throw new Error(
      `R2 is not configured. Missing environment variables: ${missing.join(', ')}`
    );
  }

  debugLog('Uploading to R2:', filePath);

  // Create S3 client for R2
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  // Read file
  const fileBuffer = await readFile(filePath);
  const contentType = getContentType(filePath);
  const key = generateUniqueKey(filePath);

  debugLog('R2 upload details:', { key, contentType, size: fileBuffer.length });

  // Upload to R2
  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  });

  await client.send(command);

  const url = `${config.publicUrl}/${key}`;

  debugLog('R2 upload complete:', url);

  return { url, key };
}
