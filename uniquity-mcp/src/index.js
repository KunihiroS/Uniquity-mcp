#!/usr/bin/env node


// グローバルなログ設定
let globalLogEnabled = process.env.LOG_ENABLED === 'on';

// ロガー関数
const logger = {
  debug: (message) => {
    if (globalLogEnabled) {
      console.error(`[DEBUG] ${message}`);
    }
  },
  info: (message) => {
    if (globalLogEnabled) {
      console.error(`[INFO] ${message}`);
    }
  },
  warn: (message) => {
    console.error(`[WARN] ${message}`);
  },
  error: (message, error = null) => {
    if (error) {
      console.error(`[ERROR] ${message}`, error);
    } else {
      console.error(`[ERROR] ${message}`);
    }
  }
};

try {
  const sdkTypes = require('@modelcontextprotocol/sdk/types.js');
  logger.debug('sdkTypes imported object: ' + JSON.stringify(Object.keys(sdkTypes), null, 2));
  logger.debug('sdkTypes.ListToolsRequestSchema exists: ' + !!sdkTypes.ListToolsRequestSchema);
  logger.debug('sdkTypes.CallToolRequestSchema exists: ' + !!sdkTypes.CallToolRequestSchema);
} catch (e) {
  logger.error('Failed to require @modelcontextprotocol/sdk/types.js:', e);
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

logger.debug('Script started.');

// process.stdin と process.stdout を明示的に渡す
const transport = new StdioServerTransport(process.stdin, process.stdout);
logger.debug('StdioServerTransport initialized.');

const server = new Server({ // McpServer から Server に変更
  name: "uniquity-mcp",
  version: "0.2.0",
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

logger.debug('McpServer instance created.');

// ツール実行ハンドラ (analyze_repository)
const handleAnalyzeRepository = async (params) => {
    logger.debug('"analyze_repository" tool handler invoked.');
    return new Promise((resolve, reject) => {
      const {
        repositoryUrl,
        openaiModel,
        logEnabled,
        logFile
      } = params;

      // コマンド引数の構築
      const commandArgs = [];

      // モデル指定（オプション）
      if (openaiModel) {
        commandArgs.push(`--model=${openaiModel}`);
      }

      // ログ設定の検証
      if (logFile && logEnabled !== 'on') {
        logger.warn(`logFile is ignored because log is not enabled. Set logEnabled='on' to enable file logging.`);
      }

      // ログ設定（オプション）
      if (logEnabled === 'on' || logEnabled === 'off') {
        commandArgs.push(`--log=${logEnabled}`);
        
        // ログファイル指定（オプション、logEnabledが'on'の場合のみ有効）
        if (logFile && logEnabled === 'on') {
          commandArgs.push(`--logfile=${logFile}`);
        }
      } else if (logEnabled) {
        logger.warn(`Invalid logEnabled value: ${logEnabled}. Must be 'on' or 'off'. Using default.`);
      }

      // 最後に必須のリポジトリURLを追加
      commandArgs.push(repositoryUrl);

      // 環境変数の設定
      const env = { ...process.env }; // 既存の環境変数を引き継ぐ

      // uniquity-reporterへのパスを解決
      // __dirname は build/ ディレクトリを指すため、node_modules は一つ上の階層にある
      const reporterPath = path.resolve(__dirname, '..', 'node_modules', '.bin', 'uniquity-reporter');

      logger.debug('Spawning uniquity-reporter with args: ' + JSON.stringify(commandArgs));
      logger.debug('Resolved reporter path: ' + reporterPath);

      const child = spawn(reporterPath, commandArgs, { env }); // フルパスで指定
      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (data) => {
        stdoutData += data.toString();
        // logger.debug('uniquity-reporter stdout chunk received.');
      });

      child.stderr.on('data', (data) => {
        stderrData += data.toString();
        logger.warn(`uniquity-reporter stderr: ${data}`);
      });

      child.on('error', (error) => {
        logger.error('uniquity-reporter spawn error:', error);
        reject(new Error(`Failed to start uniquity-reporter: ${error.message}`));
      });

      child.on('close', (code) => {
        logger.debug(`uniquity-reporter process exited with code ${code}.`);
        if (code === 0) {
          // README states the output is Markdown.
          // Return it in the standard MCP tool result format.
          if (stdoutData.trim() === '') {
            logger.warn('uniquity-reporter output was empty, but process exited successfully.');
            // MCP Host might expect content, so provide a placeholder.
            resolve({ content: [{ type: "text", text: "(No output from reporter)" }] });
          } else {
            logger.debug('Raw stdoutData from uniquity-reporter (trimmed): "' + stdoutData.trim() + '"');
            resolve({ content: [{ type: "text", text: stdoutData.trim() }] });
          }
        } else {
          logger.error(`uniquity-reporter failed with code ${code}. Stderr: ${stderrData}`);
          reject(new Error(`uniquity-reporter failed with code ${code}. Stderr: ${stderrData}`));
        }
      });
    });
  }

// ListToolsリクエストハンドラ
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.debug('ListToolsRequestSchema handler called.');
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
            logEnabled: {
              type: "string",
              enum: ['on', 'off'],
              description: "Optional: Enable or disable verbose logging. 'on' to enable, 'off' to disable."
            },
            logFile: {
              type: "string",
              description: "Optional: Full output file path for logs (Example: `./logs/debug.log`). If not specified, logs will be output to stderr."
            }
          },
          required: ["repositoryUrl"]
        }
        // outputSchema も必要であればここで定義
      }
    ]
  };
});
logger.debug('ListToolsRequestSchema handler registered.');

// CallToolリクエストハンドラ (特定のツール名に基づいて処理を分岐)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  logger.debug(`CallToolRequestSchema handler called for tool: ${name}`);
  if (name === 'analyze_repository') {
    return handleAnalyzeRepository(args);
  }
  // 他のツールがあればここで分岐
  throw new Error(`Unknown tool: ${name}`); // McpError を使う方がより適切
});
logger.debug('CallToolRequestSchema handler registered.');

server.connect(transport).then(() => {
  logger.info('Uniquity-mcp Server connected successfully via server.connect().');
}).catch((error) => {
  logger.error('Failed to connect Uniquity MCP Server via server.connect():', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  // [LOG] SIGINT received, shutting down Uniquity MCP Server...
  server.close().then(() => {
    // [LOG] Server stopped via SIGINT.
    process.exit(0);
  }).catch(err => {
    logger.error('Error stopping server via SIGINT:', err);
    process.exit(1);
  });
});
logger.debug('SIGINT handler registered.');

process.on('SIGTERM', () => {
  // [LOG] SIGTERM received, shutting down Uniquity MCP Server...
  server.close().then(() => {
    // [LOG] Server stopped via SIGTERM.
    process.exit(0);
  }).catch(err => {
    logger.error('Error stopping server via SIGTERM:', err);
    process.exit(1);
  });
});
logger.debug('SIGTERM handler registered.');
