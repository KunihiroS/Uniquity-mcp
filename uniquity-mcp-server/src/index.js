#!/usr/bin/env node


// MCP ServerとしてUniquityReporter CLIをラップし、MCP Hostからのリクエストを受けて実行する
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { spawn } = require('child_process');
const zod = require('zod');

console.log('[LOG] Script started.');

// process.stdin と process.stdout を明示的に渡す
const transport = new StdioServerTransport(process.stdin, process.stdout);
console.log('[LOG] StdioServerTransport initialized.');

const server = new McpServer({
  name: "uniquity-mcp",
  version: "0.1.0",
  description: "MCP Server for Uniquity Reporter",
  // Optional: Add more server configurations if needed
});

console.log('[LOG] McpServer instance created.');
// Define the schema for the analyze_repository tool parameters
const AnalyzeRepositoryParamsSchema = zod.object({
  repositoryUrl: zod.string().url(), // Required positional argument
  // Optional parameters based on README.md "提供ツール一覧"
  openaiModel: zod.string().optional(),
  logLevel: zod.enum(['info', 'debug', 'warn', 'error']).optional(), // Align with README.md (info, debug, warn, error)
  logFile: zod.string().optional(),
});
console.log('[LOG] AnalyzeRepositoryParamsSchema defined.');

server.tool(
  'analyze_repository',
  'Analyzes a Git repository and generates a report using Uniquity Reporter. The analysis is performed with repo=off mode, meaning no local repository copy is created or persisted.',
  AnalyzeRepositoryParamsSchema,
  {}, // annotations (空のオブジェクトまたはnull/undefined)
  async (params) => {
    console.log('[LOG] "analyze_repository" tool handler invoked.');
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

      console.log('[LOG] Spawning uniquity-reporter with args:', commandArgs);

      const child = spawn('uniquity-reporter', commandArgs, { env });
      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (data) => {
        stdoutData += data.toString();
        // console.log('[LOG] uniquity-reporter stdout chunk received.'); // Too verbose?
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
        console.log(`[LOG] uniquity-reporter process exited with code ${code}.`);
        if (code === 0) {
          try {
            // Assuming the report is JSON output to stdout
            const report = JSON.parse(stdoutData.trim()); // Trim whitespace before parsing
            // [LOG] uniquity-reporter output parsed successfully.
            resolve(report);
          } catch (e) {
            console.error("[LOG] Failed to parse uniquity-reporter output as JSON:", e);
            // If stdout is not JSON or empty, but exit code is 0,
            // consider what to return. For now, returning stdout as is.
            resolve({ rawOutput: stdoutData, message: "Process completed successfully, but output was not valid JSON." });
          }
        } else {
          console.error(`[LOG] uniquity-reporter failed with code ${code}. Stderr: ${stderrData}`);
          reject(new Error(`uniquity-reporter failed with code ${code}. Stderr: ${stderrData}`));
        }
      });
    });
  }
);
console.log('[LOG] "analyze_repository" tool registered.');

server.connect(transport).then(() => {
  console.log('[LOG] Uniquity-mcp Server connected successfully via server.connect().');
}).catch((error) => {
  console.error('[LOG] Failed to connect Uniquity MCP Server via server.connect():', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  // [LOG] SIGINT received, shutting down Uniquity MCP Server...
  server.close().then(() => { // Use server.close() as per SDK docs
    // [LOG] Server stopped via SIGINT.
    process.exit(0);
  }).catch(err => {
    console.error('[LOG] Error stopping server via SIGINT:', err);
    process.exit(1);
  });
});
console.log('[LOG] SIGINT handler registered.');

process.on('SIGTERM', () => {
  // [LOG] SIGTERM received, shutting down Uniquity MCP Server...
  server.close().then(() => { // Use server.close() as per SDK docs
    // [LOG] Server stopped via SIGTERM.
    process.exit(0);
  }).catch(err => {
    console.error('[LOG] Error stopping server via SIGTERM:', err);
    process.exit(1);
  });
});
console.log('[LOG] SIGTERM handler registered.');
