# Setup and maintenance

Locate the gateway repository from `AGENT_GATEWAY_REPO`, the current workspace, or the user's MCP configuration. Do not assume a machine-specific path.

Build and verify:

```powershell
npm ci
npm test
npm run typecheck
npm run smoke
npm audit
git diff --check
```

The gateway supports provider command overrides through `AGENT_GATEWAY_<ID>_COMMAND` and JSON `AGENT_GATEWAY_<ID>_PREFIX_ARGS`. Model and Pi credential-environment overrides are documented in the repository README.

Keep secrets in provider credential stores or the operating-system user environment. Never read or print credential values during routine diagnostics.

