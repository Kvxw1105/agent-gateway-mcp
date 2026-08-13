# Kimi Agent Gateway MCP 实现计划

**目标：** 让 Codex 通过 MCP 在指定工作目录启动、续接和查询本机 Kimi Code Agent。

**架构：** Codex 作为 MCP client 启动本地 stdio server；server 以 Kimi 0.34 支持的 `-p --output-format stream-json` 方式创建独立子进程，并返回结构化结果和 session id。现有交互式 TUI 只发现、不双写。

**技术栈：** Node.js 22、TypeScript、官方 `@modelcontextprotocol/sdk`、Zod、Kimi Code CLI。

---

### 任务 1：建立兼容层

**文件：** `src/kimi-runner.ts`、`tests/kimi-runner.test.ts`

1. 固化本机 Kimi 0.34 的参数和 JSONL 解析测试。
2. 实现跨平台命令解析、工作目录校验、超时和 session id 提取。
3. 运行 `npm test`，预期全部通过。

### 任务 2：暴露 MCP 工具

**文件：** `src/index.ts`、`src/session-store.ts`

1. 暴露 `kimi_status`、`kimi_run`、`kimi_resume`、`kimi_list_sessions`。
2. 构建后通过 MCP client 执行 `tools/list` 和 `tools/call`。
3. 用只读连接提示验证返回 `KIMI_MCP_OK`。

### 任务 3：接入 Codex

**文件：** `C:/Users/kvxkf/.codex/config.toml`

1. 添加本地 `mcp_servers.kimi-agent` stdio 配置。
2. 保留现有 MCP 配置，不改动任何密钥。
3. 重启或新建 Codex 任务后确认工具可发现。
