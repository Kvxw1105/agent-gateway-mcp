# Security

Do not include API keys, OAuth tokens, session databases, private prompts, or task logs in issues or pull requests.

Report suspected vulnerabilities privately through GitHub Security Advisories for this repository. Include the affected version, reproduction steps, and impact. Do not test against systems or accounts you do not own.

The gateway launches local coding agents with the permissions selected by the MCP caller. Use `read-only` by default, scope `work_dir` carefully, and use independent Git worktrees for parallel writers.
