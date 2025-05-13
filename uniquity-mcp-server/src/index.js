#!/usr/bin/env node

// MCP ServerとしてUniquityReporter CLIをラップし、MCP Hostからのリクエストを受けて実行する
const { Server } = require('@modelcontextprotocol/sdk');
const { spawn } = require('child_process');

// MCP Serverインスタンス生成
const mcpServer = new Server();

/**
 * MCP tool: analyze_repository
 * @param {Object} params
 * @param {string} params.repoUrl - 対象GitHubリポジトリURL
 * @param {boolean} [params.saveReport] - レポートファイル保存（repo=on）
 * @param {string} [params.reportDir] - レポート保存ディレクトリ
 * @returns {Promise<string|null>} - 生成レポート（repo=off時はMarkdown文字列、repo=on時はnull）
 */
// --- ツール登録情報を管理するための配列 ---
const toolRegistry = [];

// analyze_repository ツール登録
mcpServer.tool(
  'analyze_repository',
  {
    description: '指定したGitHubリポジトリの類似性分析レポートを生成します。repo=onの場合は指定ディレクトリにファイル保存（返却値なし）、repo=offの場合はレポート内容（Markdown）を返します。',
    parameterSchema: {
      type: 'object',
      properties: {
        repoUrl: { type: 'string', description: '分析対象のGitHubリポジトリURL' },
        saveReport: { type: 'boolean', description: 'レポートをファイル保存する場合はtrue（--repo=on）' },
        reportDir: { type: 'string', description: 'レポート保存ディレクトリ（saveReport=true時のみ有効）' }
      },
      required: ['repoUrl']
    },
    returnSchema: {
      oneOf: [
        { type: 'string', description: 'repo=off時のMarkdownレポート本文' },
        { type: 'null', description: 'repo=on時は返却値なし' }
      ]
    }
  },
  async ({ repoUrl, saveReport = false, reportDir = '' }) => {
    return new Promise((resolve, reject) => {
      const args = ['uniquity-reporter'];
      if (saveReport) {
        args.push('--repo=on');
        if (reportDir) {
          args.push(`--repofile=${reportDir}`);
        }
      } else {
        args.push('--repo=off');
      }
      args.push(repoUrl);

      const child = spawn('npx', args, { env: process.env });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      child.on('close', (code) => {
        if (code === 0) {
          if (saveReport) {
            resolve(null); // repo=on時は何も返さない
          } else {
            resolve(stdout); // repo=off時はレポート本文を返す
          }
        } else {
          reject(new Error(stderr || `UniquityReporter exited with code ${code}`));
        }
      });
    });
  }
);

toolRegistry.push({
  name: 'analyze_repository',
  description: '指定したGitHubリポジトリの類似性分析レポートを生成します。repo=onの場合はファイル保存（返却値なし）、repo=offの場合はレポート内容（Markdown）を返します。',
  parameterSchema: {
    type: 'object',
    properties: {
      repoUrl: { type: 'string', description: '分析対象のGitHubリポジトリURL' },
      saveReport: { type: 'boolean', description: 'レポートをファイル保存する場合はtrue（--repo=on）' },
      reportDir: { type: 'string', description: 'レポート保存ディレクトリ（saveReport=true時のみ有効）' }
    },
    required: ['repoUrl']
  },
  returnSchema: {
    oneOf: [
      { type: 'string', description: 'repo=off時のMarkdownレポート本文' },
      { type: 'null', description: 'repo=on時は返却値なし' }
    ]
  }
});

// ツール一覧を返すlist_toolsツール
mcpServer.tool(
  'list_tools',
  {
    description: 'このMCP Serverが提供するツールの一覧と仕様を返します。',
    parameterSchema: { type: 'object', properties: {} },
    returnSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          parameterSchema: { type: 'object' },
          returnSchema: { type: 'object' }
        }
      }
    }
  },
  async () => {
    return toolRegistry;
  }
);

mcpServer.listen();
