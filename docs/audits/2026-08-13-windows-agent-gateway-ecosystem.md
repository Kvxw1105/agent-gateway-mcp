# Windows CLI Agent Gateway 生态审计

审计日期：2026-08-13

## 本机基线

- Windows 原生 PowerShell；WSL2 Ubuntu 已安装但当前停止。
- Windows PATH 中没有 `tmux`。
- ZCode `zcode-app-cli 3.7.5-11` / runtime `0.16.1`。
- Kimi Code `0.34.0`、Claude Code `2.1.193`、Codex CLI `0.133.0`、Pi Coding Agent `0.84.1`。
- 现有网关提交：`881fb6c`，工作区干净；Codex MCP 配置指向 `dist/src/index.js`。

## 上游审计快照

所有仓库仅浅克隆审计，未执行安装脚本。

| 项目 | 审计提交 | 许可证 | Windows 原生可直接使用 | 关键结论 |
| --- | --- | --- | --- | --- |
| ReevesAgents | `7b52f77db725f4f83115da07ba73cbb6b74be06d` | Apache-2.0 | 部分 | 2026-08-12 已新增 `reevesagents-win@1.7.6`，通过 `@lydell/node-pty`/ConPTY 提供 spawn/read/send/interrupt/kill；但仅交互式终端驱动，任务随 MCP 进程退出，没有 ZCode、结构化协议、resume/wait/logs/diff/worktree，Windows 包也明确不含 Unix 版 approvals/history/config。 |
| AWS CLI Agent Orchestrator | `0903561da8578803358a42dfcd6f770cbb39601b` | Apache-2.0 | 否 | 仍要求 tmux 3.3+、Python/uv；本机原生 Windows 没有 tmux。生命周期、supervisor、worktree、控制面和权限映射很成熟，适合借鉴架构，不适合直接作为原生运行时。 |
| PAL MCP / Clink | `7afc7c1cc96e23992c8f105f960132c657883bb1` | Apache-2.0 | 部分 | 有 PowerShell 安装入口，Clink 支持 Claude/Codex/Gemini 的同步 CLI-to-CLI 调用与会话延续；不覆盖 ZCode/Kimi/Pi，缺少通用异步 wait/cancel/log/diff 生命周期，文档对 Windows + Claude 仍推荐 WSL2。 |

## reuse / adapt 决策

结论：**adapt**，不直接安装或嵌入任一完整项目。

复用原则：

1. 协议层采用官方 [Agent Client Protocol](https://agentclientprotocol.com/) 与 `@agentclientprotocol/sdk`；优先接入 Kimi ACP，逐步接入支持 ACP 的 CLI。
2. 生命周期与 MCP API 借鉴 ReevesAgents 的 spawn/read/send/interrupt/kill，并采用稳定的 task id 与持久化日志。
3. worktree、权限档位与审批边界借鉴 CAO，但只使用各 CLI 能硬执行的原生 flag；不能硬执行的限制必须明确标为 soft，不伪装成安全边界。
4. 原生 Windows 结构化子进程是主路径；ConPTY 只用于没有稳定 ACP/app-server/RPC/JSON 接口的兜底适配器。
5. 不向仍打开的交互式 TUI session 注入或双写。`send` 对非交互适配器表示在已结束 session 上启动一次受控 resume，不会向活跃 TUI 写入。

## 本项目 MVP 边界

- 通用工具：`agents_list`、`agents_spawn`、`agents_status`、`agents_wait`、`agents_logs`、`agents_cancel`、`agents_resume`。
- 第一批 provider：ZCode、Kimi、Claude、Codex、Pi。
- 任务后台运行，MCP 调用立即返回 task id；stdout/stderr 增量写入本地状态目录。
- 每个 provider 显式声明结构化输出、resume 与权限能力。
- 并行写任务必须指定独立 Git worktree；网关拒绝在同一普通 work_dir 同时启动多个写任务。
- 兼容保留 `kimi_status`、`kimi_run`、`kimi_resume`、`kimi_list_sessions`，后续给出迁移提示。

## 已知限制与后续验证

- ZCode `app-server` 与 Codex `app-server` 是各自协议，不应在没有协议测试前假定为 ACP。
- Kimi 提供 `kimi acp`；应以官方 SDK 做协议握手 smoke 后再替换现有 stream-json runner。
- Pi RPC 和 Claude stream-json 需要固定真实事件样本，并验证取消时是否会完整终止进程树。
- Windows ConPTY 可参考 ReevesAgents 的 Apache-2.0 实现或直接依赖 `@lydell/node-pty`，但在需要前不增加 native dependency。

## MVP 现场验证结果

- ZCode：通过 MCP 异步任务返回 `ZCODE_GATEWAY_OK`、exit 0 和 `sess_*`。
- Kimi：修正 `--prompt` 与 `--plan` 的非法组合后返回 `KIMI_GATEWAY_OK`、exit 0 和 `session_*`。
- Codex：0.133.0 使用用户默认 `gpt-5.6-sol` 会因版本过旧失败；网关显式使用兼容的 `gpt-5.5` 后返回 `CODEX_GATEWAY_OK`、exit 0 和 thread id。
- Claude：`claude auth status` 报 OAuth logged in，但非交互真实调用返回 `Not logged in`；归类为外部认证 blocker。
- Pi：`pi auth check --provider anthropic` 报 ready，但模型调用返回 `No API key found for anthropic`；归类为外部认证 blocker。
