# Agent Gateway MCP 项目交接包

- 生成时间：2026-08-13（Asia/Shanghai）
- 项目：Agent Gateway MCP
- 工作目录：当前仓库 checkout；不要假设固定的机器路径
- 公开仓库：<https://github.com/Kvxw1105/agent-gateway-mcp>
- 来源会话：2026-08-13 Codex 委派会话（公开文档不记录本地 task ID）
- 状态：v0.2.0 已公开发布；MVP 已验证，生产级编排仍在进行中

## 一句话定位

让一个 MCP 主控把本机多个 Agent CLI 当作独立执行器：主控负责拆解、预算、验收和合并；执行器在受控目录或独立 Git worktree 中并行工作，以 Git 产物、测试结果和结构化事件交接，而不是共享整段聊天记忆。

## 最重要的架构决策

不要把“所有 Agent 实时共享记忆、彼此自由聊天”作为近期目标。最有效且可靠的形态是中心化控制面：

```text
用户
  ↓
主控 Agent（计划、路由、预算、裁决）
  ↓
持久任务账本 / 事件流
  ↓
多个 CLI Agent + 独立 worktree
  ↓
commit / diff / tests / short summary
  ↓
主控验收、合并或退回
```

理由：

1. CLI Agent 的完整上下文格式、系统提示和 session 存储互不兼容，强行同步会昂贵且脆弱。
2. 共享聊天容易传播错误结论；共享可验证状态更可靠。
3. Git commit、diff、测试、任务契约和精简交接摘要已经足够支撑绝大多数并行开发。
4. 主控单点裁决能避免两个 Agent 同时改同一区域和互相覆盖。

因此，近期只共享四类信息：

- **任务契约**：目标、基线 commit、允许路径、权限、预算、超时、验收命令、依赖任务。
- **项目状态**：worktree、branch、HEAD、dirty 状态、锁和任务状态。
- **产物**：commit、diff、测试报告、构建产物和失败证据。
- **压缩记忆**：ADR、已确认事实、未决问题和最多几百字的 handoff；不共享完整 transcript。

## 已完成且有证据

### 网关能力

- Provider：ZCode、Kimi Code、Claude Code、Codex CLI、Pi。
- MCP 工具：`agents_list`、`agents_spawn`、`agents_status`、`agents_wait`、`agents_logs`、`agents_cancel`、`agents_resume`。
- 保留 Kimi 兼容入口。
- 支持异步任务、超时、Windows 进程树取消、增量日志、session resume。
- 默认只读；同一普通目录的并行写任务会被拒绝。
- 不向已打开的交互式 TUI 注入或双写。
- Provider 命令、prefix args 和默认模型已经环境变量化，不再依赖作者机器路径。

### 配件与跨宿主

- 仓库包含 `agent-gateway-orchestrator` Skill、Codex/通用 MCP 配置示例、Skill 安装器和多终端演示脚本。
- Skill 已安装并验证于本机 Codex 和 Claude Skills 目录。
- Gateway 本质是 stdio MCP server，不与 Codex UI 绑定；任何兼容 stdio MCP 的宿主都可接入。
- Skill 只是调度策略层；进程生命周期仍由 Gateway 实现，避免双重逻辑。

### 发布与验证

- GitHub 仓库为 PUBLIC，默认分支 `main`。
- Apache-2.0 已被 GitHub 正确识别。
- Release：`v0.2.0`，含构建后的 npm tarball 和独立 Skill zip。
- 最终 Windows GitHub Actions CI：成功。
- 本地：23/23 测试、typecheck、MCP smoke、`npm audit` 全部通过。
- 公开 Git 历史从清理后的快照开始；未公开包含个人绝对路径的早期开发提交。
- 安全扫描未发现 API Key、OAuth token、私钥或作者个人路径。

## 本机特殊状态（不要写入公开默认值）

- 开发分支：`codex/kimi-agent-gateway`；公开快照分支：`main`。
- Pi 默认：`opencode-go/deepseek-v4-flash`。
- Pi 密钥从 Windows 用户环境的 `OPENCODE_API_KEY` 读取，不记录值。
- Claude Code 原生登录仍未完成；OpenCode Go 是 OpenAI Completions 兼容接口，不能冒充 Anthropic Messages API。
- 本机 Codex MCP 配置通过环境变量启用 Claude 子进程环境清理，并设置 Pi provider/model。

## 当前能做到什么

可以：

- 由一个 MCP 主控同时启动多个不同 CLI Agent。
- 让它们在不同目录/手工准备的独立 worktree 上执行。
- 查看状态和日志，设置超时，取消整个 Windows 子进程树。
- 获取部分 provider 的最终回复和 session ID，后续受控续接。
- 进行低成本顺序升级或有界的 Harness 对比。

还不能可靠做到：

- Gateway 自动创建、验证、清理和合并 Git worktree。
- MCP server 重启后恢复 task ID、日志、锁和运行状态。
- Agent 之间实时共享通用 memory 或原生 session。
- 自动 DAG 调度、依赖解锁、失败重试、预算限额和动态路由。
- 统一 diff、artifact、approval、merge gate 和人工审批。
- 在启动前可靠判断每个 provider 是否已安装、已登录、模型可用。

## 关键不足与风险

### P0：继续并行写开发前必须解决

1. **worktree 只是声明，不是真实验证**  
   当前调用者传 `isolated_worktree=true` 即被信任；Gateway 没有验证目录确实是独立 Git worktree，也不会创建或清理它。应新增 `worktrees.create/status/remove`，并以 `git worktree list --porcelain` 验证。

2. **状态完全在内存**  
   MCP server 重启后 task、日志和写锁消失。应使用 SQLite 或 append-only JSONL 事件账本，保存 task spec、状态转换、PID、provider session、日志位置、worktree 和产物。

3. **日志无界且未脱敏**  
   当前 stdout/stderr 累积成一个内存字符串。长任务可能耗尽内存，Agent 误输出密钥也会进入日志。应改为分块落盘、大小上限、保留策略和常见凭据脱敏。

4. **缺少重启与孤儿进程恢复**  
   启动时应核对账本中的 running task、PID 和进程命令行，标记 lost/orphaned 或安全接管；不能盲杀不匹配的 PID。

5. **工作目录边界不足**  
   目前接受任意 `work_dir`。应支持 allowed roots、真实路径解析、junction/symlink 检查和敏感目录拒绝策略。

6. **provider readiness 不真实**  
   `agents_list` 返回静态能力，不代表 executable/auth/model 可用。需要 `agents_probe`：installed、version、authenticated、configured、last smoke、failure reason。

### P1：形成真正的并行开发闭环

1. 定义持久 `TaskSpec`：objective、base commit、branch、worktree、allowed paths、permission、budget、timeout、acceptance commands、dependencies。
2. 增加 `agents_artifacts`、`agents_diff`、`agents_approve`、`agents_reject`；不要急着做自由形式的 `agents_send`。
3. 实现任务 DAG：只有依赖任务通过验收才解锁下游任务。
4. 实现 merge gate：检查 dirty state、目标分支、测试、冲突、越界文件，再由主控或用户批准合并。
5. 增加并发和预算控制：全局并发、每 provider 并发、任务 token/时间上限、熔断和降级。
6. 将 Skill 的 `economy`、`compare`、`critical` 从文字策略逐步实现成可测试的 Gateway workflow。

### P2：测评、路由和有限共享记忆

1. 建立 Harness benchmark：固定 commit、prompt、权限、模型、验收命令，记录完成率、耗时、工具调用、无关改动、返工量和成本。
2. 根据历史结果做可解释路由；先规则，后评分，不要一开始上黑盒自动路由。
3. 项目记忆采用版本化 Markdown/JSON：ADR、facts、decisions、handoff、task summaries。先可审阅和可 diff，暂不引入向量数据库。
4. 只有跨大量项目检索确有收益时，再增加可选索引；索引不是事实源，Git 中的结构化文件才是事实源。

## 建议的数据模型

最小持久结构：

```text
Run
├─ run_id, controller, mode, budget, status
├─ base_repo, base_commit
└─ Tasks[]
   ├─ task_id, provider, objective, dependencies[]
   ├─ branch, worktree, allowed_paths[], permission
   ├─ timeout, acceptance_commands[]
   ├─ status, pid, provider_session_id
   └─ artifacts[]: log, summary, diff, commit, test_report
```

事件只追加：`created → queued → running → awaiting_approval → succeeded/failed/cancelled/lost → merged/rejected`。当前 `TaskStatus` 需要演进并做 schema version。

## 推荐实施顺序

### 第一切片：Durable Task Ledger

目标：MCP 重启后仍能查询历史 task、日志和最终产物。

- SQLite 存元数据和事件；stdout/stderr 分块文件存储。
- 现有 MCP API 保持兼容。
- 增加启动恢复审计和日志上限/脱敏。
- 测试：重启恢复、并发写入、损坏事件、日志截断、PID 复用安全。

### 第二切片：Managed Worktrees

目标：Gateway 自己创建并验证隔离工作区，而不是信任布尔值。

- `worktrees.create/list/remove`。
- task 必须绑定 base commit、branch 和真实 worktree identity。
- remove 前验证任务终止、目录类型、dirty state 和路径边界；默认保留 dirty worktree。

### 第三切片：Artifact + Merge Gate

目标：并行开发能真正闭环。

- 自动收集 diff、commit、test report 和短摘要。
- 主控比较结果，显式 approve/reject。
- 通过测试并无越界修改后才允许合并。

### 第四切片：Workflow + Benchmark

目标：把 `economy/compare/critical` 变为可执行工作流，并用真实数据调整路由。

## 不建议近期做的事

- 不做所有 Agent 的实时 peer-to-peer 群聊。
- 不同步完整原生 session 数据库。
- 不让多个 Agent 写同一个 worktree。
- 不把“窗口很多”当作真正并行；以独立进程、独立 worktree 和重叠运行时间为证据。
- 不在持久账本、worktree 验证和 merge gate 完成前自动合并 Agent 代码。
- 不先做花哨 UI；先把控制面做可靠。UI 可消费同一事件流后再增加。

## 关键文件

- `src/index.ts`：MCP 工具入口。
- `src/task-manager.ts`：当前内存任务生命周期和 Windows 取消。
- `src/workspace-policy.ts`：当前进程内写锁；P0 改造重点。
- `src/providers/catalog.ts`：provider 发现、模型和命令覆盖。
- `src/providers/output.ts`：结构化事件解析。
- `integrations/skills/agent-gateway-orchestrator/`：跨宿主调度 Skill。
- `tests/provider-live-smoke.ts`：真实 provider smoke 和可视化终端入口。
- `docs/audits/2026-08-13-windows-agent-gateway-ecosystem.md`：ReevesAgents、AWS CAO、PAL 等生态审计。

## 接手前验证

```powershell
cd <agent-gateway-mcp checkout>
git status --short
git branch -vv
npm ci
npm test
npm run typecheck
npm run smoke
npm audit
```

不要默认运行真实 provider smoke，它会消耗用户模型额度。只有用户明确允许时才运行指定 provider 的有界 smoke。

## 下一位 Agent 的首个任务

先实现 **Durable Task Ledger 的设计和最小切片**，不要同时做 worktree manager：

1. 读取本文件、README、`src/task-manager.ts`、`src/index.ts` 和相关测试。
2. 保持现有 MCP 工具兼容，写出 SQLite/事件日志的最小 schema 和迁移策略。
3. 先用测试覆盖“任务完成后重启 server 仍能 status/logs”；再实现。
4. 日志必须流式落盘、有上限和脱敏，不把 stdout 全部留在内存。
5. 不调用真实 Agent 模型完成单元测试。
6. 完成后更新本交接文件中的状态和下一步，并通过 CI。

## 新会话恢复指令

> 请先读取 `.context/handoff/2026-08-13-agent-gateway-handoff.md`，再检查实际 Git 状态和公开仓库 CI。按“下一位 Agent 的首个任务”继续；不要重复已验证的 v0.2.0 发布工作，也不要运行会消耗模型额度的 live smoke。
