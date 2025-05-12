# Uniquity MCP Server

Uniquity MCP Serverは、UniquityReporterの機能をMCP（Model Context Protocol）経由で外部ツールやエージェントから利用可能にするためのラッパーサーバです。

## 目的

- UniquityReporter（本体）の分析機能をMCP Hostや各種AIエージェントから呼び出せるようにする
  https://github.com/KunihiroS/UniquityReporter
- CLI/SDK本体の責務と分離し、保守性・拡張性を高める

## 構成方針

- 本リポジトリ&#x306F;__&#x4D;CP Serverラッパーの&#x307F;__&#x3092;管理し、コアロジックは`uniquity-reporter` npmパッケージに依存します
- MCP Hostからのリクエストを受け、UniquityReporter CLI/SDKを呼び出し、結果を返却します
- 標準入出力（stdin/stdout）ベースのプロセス間通信を基本とします

## アーキテクチャ図
```mermaid
graph LR
    subgraph MCP Host
        Client
    end
    subgraph MCP Server
        Server(MCP Server) --> UniquityReporter
    end
    
    Client -- リクエスト --> Server
    Server -- レスポンス --> Client
    UniquityReporter -- GitHub API --> GitHub
    UniquityReporter -- OpenAI API --> OpenAI
    UniquityReporter -- Tavily API --> Tavily
```

## 実装方針・構成

- __Node.js（TypeScript/JavaScript）で実装__
- コア分析ロジックは `uniquity-reporter` npmパッケージを利用
- MCPプロトコル対応には `@modelcontextprotocol/sdk` などの公式SDKを活用
- MCP Hostからのリクエスト（例: analyze_repository）を受け、`uniquity-reporter`のCLI/SDK APIを呼び出し、結果を標準出力で返却

### ディレクトリ構成例

```javascript
uniquity-mcp/
├── src/
│   └── index.js (または index.ts)
├── package.json
├── README.md
└── ...
```

### 依存関係

- `uniquity-reporter`（npm依存として追加）
- `@modelcontextprotocol/sdk`（MCP通信用）

```bash
pnpm add uniquity-reporter @modelcontextprotocol/sdk
```

### MCP Serverの基本実装例

```js
// src/index.js
const { Server } = require('@modelcontextprotocol/sdk');
const { analyzeProject } = require('uniquity-reporter');

const mcpServer = new Server();

mcpServer.tool('analyze_repository', async ({ repoUrl }) => {
  // 必要に応じて環境変数をセット
  // 分析実行
  const report = await analyzeProject(repoUrl, { output: 'stdout' });
  return report;
});

mcpServer.listen();
```

### 起動方法

- MCP Client からの起動
- もしくは、テスト時などは CLI からも起動

```bash
node src/index.js
```

または

```bash
npx uniquity-mcp-server
```

### 開発・テスト

- `uniquity-reporter`のバージョンアップ時は、依存を更新し動作確認を必ず実施
- CI/CDでユニットテスト・E2Eテストを自動化

### 環境変数

- MCP Host の settings.json に各種secretsおよび呼び出しコマンドを記載

## 開発ルール

- MCP ServerはNode.js（TypeScript/JavaScript）で実装
- コアロジックの改修は`uniquity-reporter`側で行い、本リポジトリではラッパー・インターフェイス層のみを管理
- バージョン管理・リリースは本体と独立して行う
- セキュリティ（APIキー等）は環境変数で管理し、コードに直接記載しない
