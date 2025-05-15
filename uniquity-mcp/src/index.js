#!/usr/bin/env node


// MCP ServerとしてUniquityReporter CLIをラップし、MCP Hostからのリクエストを受けて実行する
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { spawn } = require('child_process');
const zod = require('zod');

console.error('[LOG] Script started.'); // Output to stderr

// process.stdin と process.stdout を明示的に渡す
const transport = new StdioServerTransport(process.stdin, process.stdout);
console.error('[LOG] StdioServerTransport initialized.'); // Output to stderr

const server = new McpServer({
  name: "uniquity-mcp",
  version: "0.1.0",
  description: "MCP Server for Uniquity Reporter",
  // Optional: Add more server configurations if needed
});

console.error('[LOG] McpServer instance created.'); // Output to stderr
// Define the schema for the analyze_repository tool parameters
const AnalyzeRepositoryParamsSchema = zod.object({
  repositoryUrl: zod.string().url(), // Required positional argument
  // Optional parameters based on README.md "提供ツール一覧"
  openaiModel: zod.string().optional(),
  logLevel: zod.enum(['info', 'debug', 'warn', 'error']).optional(), // Align with README.md (info, debug, warn, error)
  logFile: zod.string().optional(),
});
console.error('[LOG] AnalyzeRepositoryParamsSchema defined.'); // Output to stderr

// Manually define the JSON Schema for the tool's input parameters
const AnalyzeRepositoryInputSchema = {
  type: "object",
  properties: {
    repositoryUrl: {
      type: "string",
      format: "url",
      description: "The URL of the Git repository to analyze."
    },
    openaiModel: {
      type: "string",
      description: "Optional: The OpenAI model to use (e.g., gpt-4o-mini)."
    },
    logLevel: {
      type: "string",
      enum: ['info', 'debug', 'warn', 'error'],
      description: "Optional: The log level for the reporter."
    },
    logFile: {
      type: "string",
      description: "Optional: The path to a log file for the reporter."
    }
  },
  required: ["repositoryUrl"]
};

server.tool(
  'analyze_repository',
  'Analyzes a Git repository and generates a report using Uniquity Reporter. The analysis is performed with repo=off mode, meaning no local repository copy is created or persisted.',
  AnalyzeRepositoryInputSchema, // Use the manually defined JSON Schema
  {}, // annotations (空のオブジェクトまたはnull/undefined)
  async (params) => {
    console.error('[LOG] "analyze_repository" tool handler invoked.'); // Output to stderr
    return new Promise((resolve, reject) => {
      const {
        repositoryUrl,
        openaiModel,
        logLevel,
        logFile
      } = params;

      // Based on the provided CLI spec, command args are just --repo=off and the URL.
      const commandArgs = ['--repo=off', repositoryUrl];

      // Environment variables are set based on optional tool parameters
      // as per README.md "提供ツール一覧" and "注意事項".
      // These will override any existing environment variables from the MCP Host if provided.
      const env = { ...process.env }; // Keep existing process environment
      if (openaiModel) {
        env.OPENAI_MODEL = openaiModel;
      }
      if (logLevel) {
        env.LOG_LEVEL = logLevel;
      }
      if (logFile) {
        env.LOG_FILE = logFile;
      }

      console.error('[LOG] Spawning uniquity-reporter with args:', commandArgs); // Output to stderr

      const child = spawn('uniquity-reporter', commandArgs, { env });
      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (data) => {
        stdoutData += data.toString();
        // console.error('[LOG] uniquity-reporter stdout chunk received.'); // If needed, output to stderr
      });

      child.stderr.on('data', (data) => {
        stderrData += data.toString();
        console.error(`[LOG] uniquity-reporter stderr: ${data}`);
      });

      child.on('error', (error) => {
        console.error(`[LOG] uniquity-reporter spawn error: ${error}`);
        reject(new Error(`Failed to start uniquity-reporter: ${error.message}`));
      });

      child.on('close', (code) => {
        console.error(`[LOG] uniquity-reporter process exited with code ${code}.`); // Output to stderr
        if (code === 0) {
          // README states the output is Markdown.
          // Return it in the standard MCP tool result format.
          if (stdoutData.trim() === '') {
            console.error("[WARN] uniquity-reporter output was empty, but process exited successfully."); // Output to stderr
            // MCP Host might expect content, so provide a placeholder.
            resolve({ content: [{ type: "text", text: "(No output from reporter)" }] });
          } else {
            console.error("[LOG] Raw stdoutData from uniquity-reporter (trimmed):", `"${stdoutData.trim()}"`); // Output to stderr
            resolve({ content: [{ type: "text", text: stdoutData.trim() }] });
          }
        } else {
          console.error(`[LOG] uniquity-reporter failed with code ${code}. Stderr: ${stderrData}`);
          reject(new Error(`uniquity-reporter failed with code ${code}. Stderr: ${stderrData}`));
        }
      });
    });
  }
);
console.error('[LOG] "analyze_repository" tool registered.'); // Output to stderr

server.connect(transport).then(() => {
  console.error('[LOG] Uniquity-mcp Server connected successfully via server.connect().'); // Output to stderr
}).catch((error) => {
  console.error('[LOG] Failed to connect Uniquity MCP Server via server.connect():', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  // [LOG] SIGINT received, shutting down Uniquity MCP Server...
  server.close().then(() => {
    // [LOG] Server stopped via SIGINT.
    process.exit(0);
  }).catch(err => {
    console.error('[LOG] Error stopping server via SIGINT:', err);
    process.exit(1);
  });
});
console.error('[LOG] SIGINT handler registered.'); // Output to stderr

process.on('SIGTERM', () => {
  // [LOG] SIGTERM received, shutting down Uniquity MCP Server...
  server.close().then(() => {
    // [LOG] Server stopped via SIGTERM.
    process.exit(0);
  }).catch(err => {
    console.error('[LOG] Error stopping server via SIGTERM:', err);
    process.exit(1);
  });
});
console.error('[LOG] SIGTERM handler registered.'); // Output to stderr
