# Routing and evaluation

| Work | First choice | Escalate when |
| --- | --- | --- |
| Small read-only analysis, search, routine fixes | Pi | Failure, drift, or failed tests |
| Long-context understanding, concise second opinion | Kimi | Evidence is weak or implementation is needed |
| Implementation and detailed engineering suggestions | ZCode | Constraints or latency are poor |
| Independent review | Claude, when authenticated | Skip if unavailable |
| Architecture, difficult debugging, final judgment | Controller/Codex | Reserve for high-value work |

Treat this as a starting policy, not a permanent ranking. Update it from measured project outcomes.

For harness comparisons, fix the commit, prompt, permissions, allowed files, and acceptance tests. Record success, duration, tool calls, unrelated edits, instruction following, log volume, and controller rework.

Different models measure the combined model-plus-harness system. A closer harness-only comparison requires the same model, parameters, inputs, and environment.

