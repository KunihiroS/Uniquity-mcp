#!/usr/bin/env node


// MCP ServerとしてUniquityReporter CLIをラップし、MCP Hostからのリクエストを受けて実行する
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { spawn } = require('child_process');
const zod = require('zod');

// process.stdin と process.stdout を明示的に渡す
const transport = new StdioServerTransport(process.stdin, process.stdout);

const server = new McpServer({
  name: "uniquity-mcp-server",
  version: "0.1.0",
  description: "MCP Server for Uniquity Reporter",
  transport: transport, // transport インスタンスをここで指定
  // Optional: Add more server configurations if needed
});

// Define the schema for the analyze_repository tool parameters
const AnalyzeRepositoryParamsSchema = zod.object({
  repositoryUrl: zod.string().url(),
  analysisTypes: zod.array(zod.string()).optional(),
  excludePatterns: zod.array(zod.string()).optional(),
  includePatterns: zod.array(zod.string()).optional(),
  maxFileSize: zod.number().int().positive().optional(),
  openaiModel: zod.string().optional(),
  logLevel: zod.enum(['error', 'warn', 'info', 'debug', 'trace']).optional(),
  logFile: zod.string().optional(),
});

server.tool(
  'analyze_repository',
  'Analyzes a Git repository and generates a report using Uniquity Reporter. The analysis is performed with repo=off mode, meaning no local repository copy is created or persisted.',
  AnalyzeRepositoryParamsSchema,
  {}, // annotations (空のオブジェクトまたはnull/undefined)
  async (params) => {
    // [LOG] 'analyze_repository' tool handler invoked (paramsは必要に応じてstderr/logファイルへ)
    return new Promise((resolve, reject) => {
      const {
        repositoryUrl,
        analysisTypes,
        excludePatterns,
        includePatterns,
        maxFileSize,
        openaiModel,
        logLevel,
        logFile,
      } = params;

      const commandArgs = ['--repo=off', `--repository-url=${repositoryUrl}`];

      if (analysisTypes && analysisTypes.length > 0) {
        commandArgs.push(`--analysis-types=${analysisTypes.join(',')}`);
      }
      if (excludePatterns && excludePatterns.length > 0) {
        commandArgs.push(`--exclude-patterns=${excludePatterns.join(',')}`);
      }
      if (includePatterns && includePatterns.length > 0) {
        commandArgs.push(`--include-patterns=${includePatterns.join(',')}`);
      }
      if (maxFileSize) {
        commandArgs.push(`--max-file-size=${maxFileSize}`);
      }

      const env = { ...process.env };
      if (openaiModel) {
        env.UNIQUITY_OPENAI_MODEL = openaiModel;
      }
      if (logLevel) {
        env.UNIQUITY_LOG_LEVEL = logLevel;
      }
      if (logFile) {
        env.UNIQUITY_LOG_FILE = logFile;
      }

      // [LOG] Spawning uniquity-reporter, args/envは必要に応じてstderr/logファイルへ

      const child = spawn('uniquity-reporter', commandArgs, { env });
      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (data) => {
        stdoutData += data.toString();
        // [LOG] uniquity-reporter stdout: ログは必要に応じてstderr/logファイルへ
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
        // [LOG] uniquity-reporter process exited with code (stderr/logファイルへ)
        if (code === 0) {
          try {
            // Assuming the report is JSON output to stdout
            const report = JSON.parse(stdoutData);
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

transport.start().then(() => {
  // [LOG] Uniquity MCP Server started successfully via transport.start().
}).catch((error) => {
  console.error('[LOG] Failed to start Uniquity MCP Server via transport.start():', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  // [LOG] SIGINT received, shutting down Uniquity MCP Server...
  transport.stop().then(() => {
    // [LOG] Server stopped via SIGINT.
    process.exit(0);
  }).catch(err => {
    console.error('[LOG] Error stopping server via SIGINT:', err);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  // [LOG] SIGTERM received, shutting down Uniquity MCP Server...
  transport.stop().then(() => {
    // [LOG] Server stopped via SIGTERM.
    process.exit(0);
  }).catch(err => {
    console.error('[LOG] Error stopping server via SIGTERM:', err);
    process.exit(1);
  });
});
