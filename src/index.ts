#!/usr/bin/env node

/**
 * xAI Grok Imagine Video MCP Server
 *
 * Model Context Protocol server for xAI's Grok Imagine Video API
 * Enables video generation and editing through Claude Desktop and other MCP clients
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as dotenv from 'dotenv';
import { generateVideo, formatGenerateResult } from './tools/generate.js';
import { editVideo, formatEditResult } from './tools/edit.js';
import { extendVideo, formatExtendResult } from './tools/extend.js';
import { uploadFileToXai, getUploadMimeType } from './utils/files.js';
import { debugLog } from './utils/debug.js';

// Load environment variables
dotenv.config();

// Validate API key
const apiKey = process.env.XAI_API_KEY;
if (!apiKey) {
  console.error(
    'Error: XAI_API_KEY environment variable is required.\n' +
      'Please set it in your environment or .env file.\n' +
      'Get your API key from: https://console.x.ai/\n' +
      'Example: export XAI_API_KEY="xai-..."\n'
  );
  process.exit(1);
}

// Create MCP server
const server = new Server(
  {
    name: 'grok-imagine-video-mcp-server',
    version: '1.6.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
const TOOLS = [
  {
    name: 'generate_video',
    description:
      'Generate a new video using xAI Grok Imagine Video API (grok-imagine-video). ' +
      'Supports text-to-video (T2V), image-to-video (I2V), and reference-to-video (R2V). ' +
      'Supports aspect ratios: 16:9, 4:3, 1:1, 9:16, 3:4, 3:2, 2:3. ' +
      'Video duration: 1-15 seconds (default 8). Resolution: 480p, 720p, or 1080p. ' +
      'For image-to-video, provide image_url, image_path, or image_file_id. ' +
      'For reference-to-video, provide reference_images.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Text prompt describing the video. Required for text-to-video and ' +
            'reference-to-video; optional for image-to-video (image alone drives generation).',
        },
        output_path: {
          type: 'string',
          description: 'Output file path (default: generated_video.mp4)',
        },
        model: {
          type: 'string',
          enum: ['grok-imagine-video', 'grok-imagine-video-1.5'],
          description: 'Model to use (default: grok-imagine-video)',
        },
        duration: {
          type: 'number',
          description: 'Video duration in seconds (1-15, default: 8)',
          minimum: 1,
          maximum: 15,
        },
        aspect_ratio: {
          type: 'string',
          enum: ['16:9', '4:3', '1:1', '9:16', '3:4', '3:2', '2:3'],
          description: 'Aspect ratio (default: 16:9)',
        },
        resolution: {
          type: 'string',
          enum: ['480p', '720p', '1080p'],
          description: 'Resolution of the generated video (default: 720p)',
        },
        image_url: {
          type: 'string',
          description: 'Source image URL for image-to-video generation (optional)',
        },
        image_path: {
          type: 'string',
          description:
            'Local image file path for image-to-video generation. ' +
            'Sent as a base64 data URL; files over 10 MB are uploaded via the ' +
            'xAI Files API automatically (max 48 MB). ' +
            'Cannot be used together with image_url or image_file_id.',
        },
        image_file_id: {
          type: 'string',
          description:
            'File ID from the xAI Files API for image-to-video generation. ' +
            'Cannot be used together with image_url or image_path.',
        },
        reference_images: {
          type: 'array',
          description:
            'Reference images for reference-to-video (R2V) generation, used as ' +
            'style/content references. Cannot be combined with image_url/image_path/image_file_id.',
          items: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'Public URL or base64 data URL of the reference image',
              },
              path: {
                type: 'string',
                description: 'Local image file path (sent as a base64 data URL)',
              },
              file_id: {
                type: 'string',
                description: 'File ID from the xAI Files API',
              },
            },
          },
        },
      },
      // prompt is conditionally required (T2V/R2V) and validated server-side,
      // so it is intentionally omitted here to allow image-to-video without a prompt.
      required: [],
    },
  },
  {
    name: 'edit_video',
    description:
      'Edit an existing video using xAI Grok Imagine Video API. ' +
      'Provide a source video URL along with a prompt describing the desired changes. ' +
      'The maximum supported video length is 8.7 seconds. ' +
      'The edited video will have the same duration as the original.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description of the desired edits to make to the video',
        },
        video_url: {
          type: 'string',
          description:
            'URL of the source video to edit (must be publicly accessible, max 8.7 seconds). ' +
            'Provide exactly one of video_url, video_path, or video_file_id.',
        },
        video_path: {
          type: 'string',
          description:
            'Local video file path (.mp4). Uploaded to the xAI Files API automatically. ' +
            'Provide exactly one of video_url, video_path, or video_file_id.',
        },
        video_file_id: {
          type: 'string',
          description:
            'File ID of the source video from the xAI Files API. ' +
            'Provide exactly one of video_url, video_path, or video_file_id.',
        },
        output_path: {
          type: 'string',
          description: 'Output file path (default: edited_video.mp4)',
        },
        model: {
          type: 'string',
          enum: ['grok-imagine-video', 'grok-imagine-video-1.5'],
          description: 'Model to use (default: grok-imagine-video)',
        },
      },
      // video source (video_url XOR video_file_id) is validated server-side
      required: ['prompt'],
    },
  },
  {
    name: 'extend_video',
    description:
      'Extend an existing video by generating continuation content using xAI Grok Imagine Video API. ' +
      'Provide a source video URL and a prompt describing what should happen next. ' +
      'The extension segment duration is 1-10 seconds (default 6).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description of what should happen next in the video',
        },
        video_url: {
          type: 'string',
          description:
            'URL of the source video to extend (public URL or base64 data URL, .mp4). ' +
            'Provide exactly one of video_url, video_path, or video_file_id.',
        },
        video_path: {
          type: 'string',
          description:
            'Local video file path (.mp4). Uploaded to the xAI Files API automatically. ' +
            'Provide exactly one of video_url, video_path, or video_file_id.',
        },
        video_file_id: {
          type: 'string',
          description:
            'File ID of the source video from the xAI Files API. ' +
            'Provide exactly one of video_url, video_path, or video_file_id.',
        },
        output_path: {
          type: 'string',
          description: 'Output file path (default: extended_video.mp4)',
        },
        model: {
          type: 'string',
          enum: ['grok-imagine-video', 'grok-imagine-video-1.5'],
          description: 'Model to use (default: grok-imagine-video)',
        },
        duration: {
          type: 'number',
          description: 'Duration of the extension segment in seconds (1-10, default: 6)',
          minimum: 1,
          maximum: 10,
        },
      },
      // video source (video_url XOR video_file_id) is validated server-side
      required: ['prompt'],
    },
  },
  {
    name: 'upload_file',
    description:
      'Upload a local image or video file to the xAI Files API and get a file_id. ' +
      'The file stays private; the returned file_id can be used as input for ' +
      'generate_video (image_file_id, reference_images[].file_id), edit_video, and ' +
      'extend_video (video_file_id). Useful for reusing the same asset across ' +
      'multiple calls without re-uploading. ' +
      'Supported: images (jpg/jpeg/png/gif/webp/bmp/tiff) and videos (mp4), max 48 MB.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Local path of the image or video file to upload',
        },
      },
      required: ['file_path'],
    },
  },
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debugLog('Listing available tools');
  return { tools: TOOLS };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  debugLog(`Tool called: ${name}`, args);

  try {
    switch (name) {
      case 'generate_video': {
        const result = await generateVideo(apiKey!, args as any);
        const text = formatGenerateResult(result);
        return { content: [{ type: 'text', text }] };
      }

      case 'edit_video': {
        const result = await editVideo(apiKey!, args as any);
        const text = formatEditResult(result);
        return { content: [{ type: 'text', text }] };
      }

      case 'extend_video': {
        const result = await extendVideo(apiKey!, args as any);
        const text = formatExtendResult(result);
        return { content: [{ type: 'text', text }] };
      }

      case 'upload_file': {
        const filePath = (args as any)?.file_path;
        if (!filePath || typeof filePath !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'file_path is required');
        }
        const mimeType = getUploadMimeType(filePath);
        const uploaded = await uploadFileToXai(apiKey!, filePath, mimeType);
        const text =
          `File uploaded successfully to the xAI Files API.\n\nDetails:\n` +
          `  - File ID: ${uploaded.file_id}\n` +
          `  - Filename: ${uploaded.filename}\n` +
          `  - Size: ${(uploaded.bytes / (1024 * 1024)).toFixed(2)} MB\n\n` +
          `Use this file_id as image_file_id / reference_images[].file_id (images) ` +
          `or video_file_id (videos) in subsequent calls.`;
        return { content: [{ type: 'text', text }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error: any) {
    debugLog('Tool execution error:', error);

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  debugLog('Starting xAI Grok Imagine Video MCP Server');
  debugLog(`API Key configured: ${apiKey!.substring(0, 10)}...`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  debugLog('Server running on stdio transport');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
