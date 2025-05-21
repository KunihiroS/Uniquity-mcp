#!/usr/bin/env node


/// Global log settings
let globalLogEnabled = process.env.LOG_ENABLED === 'on';

/// Logger function
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
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js'); 
// Import type from SDE.
/// Wrap UniquityReporter CLI as an MCP Server and execute requests from MCP Host
/// Previous import: const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js'); /// Try import similar to claude-code-server
/// If Server is not found above, try the main export of the SDK: const { Server } = require('@modelcontextprotocol/sdk');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { spawn } = require('child_process');
const path = require('path'); /// Import path module
const zod = require('zod');

logger.debug('Script started.');

/// Explicitly pass process.stdin and process.stdout
const transport = new StdioServerTransport(process.stdin, process.stdout);
logger.debug('StdioServerTransport initialized.');

const server = new Server({ /// Changed from McpServer to Server
  name: "uniquity-mcp",
  description: "MCP Server for Uniquity Reporter",
  /// Declare server capabilities, specifically that it supports tools
}, {
  capabilities: {
    tools: {
      // You can add more specific tool capabilities here if needed by the SDK version,
      // for example, if it supports dynamic tool registration/unregistration:
      // listChanged: true // Example, check SDK docs for v1.11.2
    }
  }});

logger.debug('McpServer instance created.');

/// Tool execution handler (analyze_repository)
const handleAnalyzeRepository = async (params) => {
    logger.debug('"analyze_repository" tool handler invoked.');
    return new Promise((resolve, reject) => {
      const {
        repositoryUrl,
        openaiModel,
        logEnabled
      } = params;

      /// Build command arguments
      const commandArgs = [];

      /// Model specification (optional)
      if (openaiModel) {
        commandArgs.push(`--model=${openaiModel}`);
      }

      /// Log setting (optional)
      if (logEnabled === 'on' || logEnabled === 'off') {
        commandArgs.push(`--log=${logEnabled}`);
      } else if (logEnabled) {
        logger.warn(`Invalid logEnabled value: ${logEnabled}. Must be 'on' or 'off'. Using default.`);
      }

      /// Add the required repository URL at the end
      commandArgs.push(repositoryUrl);

      /// Set environment variables
      const env = { ...process.env }; /// Inherit existing environment variables

      /// Set PATH to include node_modules/.bin for bin command resolution
      env.PATH = [
        path.resolve(__dirname, '..', 'node_modules', '.bin'),
        process.env.PATH
      ].join(':');

      logger.debug('Spawning uniquity-reporter with args: ' + JSON.stringify(commandArgs));
      // コマンド名だけでspawnし、PATHで解決
      const child = spawn('uniquity-reporter', commandArgs, { env });
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

// ListTools request handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.debug('ListToolsRequestSchema handler called.');
  return {
    tools: [
      {
        name: "analyze_repository",
        description: "Analyzes a Git repository and generates a report using Uniquity Reporter. The analysis is performed with repo=off mode, meaning no local repository copy is created or persisted.",
        inputSchema: { // Json Schema definition
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
            }
          },
          required: ["repositoryUrl"]
        }
        // outputSchema if needed.
      }
    ]
  };
});
  logger.debug('ListToolsRequestSchema handler registered.');

/// CallTool request handler (branch processing based on specific tool name)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  logger.debug(`CallToolRequestSchema handler called for tool: ${name}`);
  if (name === 'analyze_repository') {
    return handleAnalyzeRepository(args);
  }
  /// Branch for other tools if available
  throw new Error(`Unknown tool: ${name}`); /// It would be more appropriate to use McpError
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
  /// SIGINT received, shutting down Uniquity MCP Server...
  server.close().then(() => {
    /// Server stopped via SIGINT.
    process.exit(0);
  }).catch(err => {
    logger.error('Error stopping server via SIGINT:', err);
    process.exit(1);
  });
});
logger.debug('SIGINT handler registered.');

process.on('SIGTERM', () => {
  /// SIGTERM received, shutting down Uniquity MCP Server...
  server.close().then(() => {
    /// Server stopped via SIGTERM.
    process.exit(0);
  }).catch(err => {
    logger.error('Error stopping server via SIGTERM:', err);
    process.exit(1);
  });
});
logger.debug('SIGTERM handler registered.');
