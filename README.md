# Local Agent Gateway MCP

本机外部 Agent 网关的最小可用版本，目前接入 Kimi Code CLI 0.34+。

## 工具

- `kimi_status`：检查 Kimi CLI。
- `kimi_run`：在指定目录启动独立 Kimi Agent。
- `kimi_resume`：续接已结束的 session；不要与仍打开的 TUI 双写。
- `kimi_list_sessions`：发现本机 Kimi sessions。

## 开发验证

```powershell
npm install
npm test
npm run typecheck
```

Codex 配置指向 `node D:/Users/kvxkf/Documents/ChatGPT/agent-gateway-mcp/dist/src/index.js`。修改代码后先执行 `npm run build`；新建 Codex 任务或重启应用后加载新 MCP。
