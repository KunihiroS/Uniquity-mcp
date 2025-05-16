#!/usr/bin/env node


try {
  const sdkTypes = require('@modelcontextprotocol/sdk/types.js');
  console.error('[DEBUG] sdkTypes imported object:', JSON.stringify(Object.keys(sdkTypes), null, 2));
  console.error('[DEBUG] sdkTypes.ListToolsRequestSchema exists:', !!sdkTypes.ListToolsRequestSchema);
  console.error('[DEBUG] sdkTypes.CallToolRequestSchema exists:', !!sdkTypes.CallToolRequestSchema);
} catch (e) {
  console.error('[DEBUG] Failed to require @modelcontextprotocol/sdk/types.js:', e);
}
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js'); // SDKの型定義をインポート
// MCP ServerとしてUniquityReporter CLIをラップし、MCP Hostからのリクエストを受けて実行する
// const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js'); // 以前のインポート
const { Server } = require('@modelcontextprotocol/sdk/server/index.js'); // claude-code-server と同様のインポートを試す
// もし上記で Server が見つからない場合、SDKのメインエクスポートを試す:
// const { Server } = require('@modelcontextprotocol/sdk');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { spawn } = require('child_process');
const path = require('path'); // pathモジュールをインポート
const zod = require('zod');

console.error('[LOG] Script started.'); // Output to stderr

// process.stdin と process.stdout を明示的に渡す
const transport = new StdioServerTransport(process.stdin, process.stdout);
console.error('[LOG] StdioServerTransport initialized.'); // Output to stderr

const server = new Server({ // McpServer から Server に変更
  name: "uniquity-mcp",
  version: "0.1.0",
  description: "MCP Server for Uniquity Reporter",
  // Declare server capabilities, specifically that it supports tools
}, {
  capabilities: {
    tools: {
      // You can add more specific tool capabilities here if needed by the SDK version,
      // for example, if it supports dynamic tool registration/unregistration:
      // listChanged: true // Example, check SDK docs for v1.11.2
    }
  }});

console.error('[LOG] McpServer instance created.'); // Output to stderr

// ツール実行ハンドラ (analyze_repository)
const handleAnalyzeRepository = async (params) => {
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

      // uniquity-reporterへのパスを解決
      // __dirname は build/ ディレクトリを指すため、node_modules は一つ上の階層にある
      const reporterPath = path.resolve(__dirname, '..', 'node_modules', '.bin', 'uniquity-reporter');

      console.error('[LOG] Spawning uniquity-reporter with args:', commandArgs); // Output to stderr
      console.error('[LOG] Resolved reporter path:', reporterPath); // デバッグ用にパスを出力

      const child = spawn(reporterPath, commandArgs, { env }); // フルパスで指定
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

// ListToolsリクエストハンドラ
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error('[LOG] ListToolsRequestSchema handler called.');
  return {
    tools: [
      {
        name: "analyze_repository",
        description: "Analyzes a Git repository and generates a report using Uniquity Reporter. The analysis is performed with repo=off mode, meaning no local repository copy is created or persisted.",
        inputSchema: { // ここで直接JSON Schemaを定義
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
        }
        // outputSchema も必要であればここで定義
      }
    ]
  };
});
console.error('[LOG] ListToolsRequestSchema handler registered.');

// CallToolリクエストハンドラ (特定のツール名に基づいて処理を分岐)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  console.error(`[LOG] CallToolRequestSchema handler called for tool: ${name}`);
  if (name === 'analyze_repository') {
    return handleAnalyzeRepository(args);
  }
  // 他のツールがあればここで分岐
  throw new Error(`Unknown tool: ${name}`); // McpError を使う方がより適切
});
console.error('[LOG] CallToolRequestSchema handler registered.');

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
