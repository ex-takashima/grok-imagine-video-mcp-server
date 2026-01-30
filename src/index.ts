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
    version: '1.0.0',
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
      'Generate a new video from a text prompt using xAI Grok Imagine Video API. ' +
      'Uses grok-imagine-video model. ' +
      'Supports aspect ratios: 16:9, 4:3, 1:1, 9:16, 3:4, 3:2, 2:3. ' +
      'Video duration: 1-15 seconds. Resolution: 720p or 480p. ' +
      'Can also generate video from an image (image-to-video).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The text prompt describing the video to generate',
        },
        output_path: {
          type: 'string',
          description: 'Output file path (default: generated_video.mp4)',
        },
        model: {
          type: 'string',
          enum: ['grok-imagine-video'],
          description: 'Model to use (default: grok-imagine-video)',
        },
        duration: {
          type: 'number',
          description: 'Video duration in seconds (1-15, default: 5)',
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
          enum: ['720p', '480p'],
          description: 'Resolution of the generated video (default: 720p)',
        },
        image_url: {
          type: 'string',
          description: 'Source image URL for image-to-video generation (optional)',
        },
      },
      required: ['prompt'],
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
          description: 'URL of the source video to edit (must be publicly accessible, max 8.7 seconds)',
        },
        output_path: {
          type: 'string',
          description: 'Output file path (default: edited_video.mp4)',
        },
        model: {
          type: 'string',
          enum: ['grok-imagine-video'],
          description: 'Model to use (default: grok-imagine-video)',
        },
      },
      required: ['prompt', 'video_url'],
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
