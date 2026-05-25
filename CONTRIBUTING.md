# Contributing / 贡献指南

Thanks for helping improve Seedance Movie MCP.

感谢你帮助改进 Seedance Movie MCP。

## Development Setup / 开发环境

```bash
npm install
npm test
npm run build
node scripts/start-mcp.mjs --check
```

Use the install scripts when you need to validate Codex integration:

需要验证 Codex 集成时，使用安装脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-codex.ps1
```

```bash
bash scripts/install-codex.sh
```

## Contribution Rules / 贡献规则

- Keep API keys and private prompts out of commits.
- Keep generated videos, manifests, logs, `dist/`, `node_modules/`, and `.mcp-runtime/` out of commits.
- Prefer small, focused pull requests.
- Add or update tests for behavior changes.
- Keep public-facing docs bilingual when changing user-visible behavior.
- Preserve Windows Codex App, Windows Codex CLI, and Linux Codex CLI compatibility.

- 不要提交 API key、私有提示词或本机 Codex 配置。
- 不要提交生成视频、manifest、日志、`dist/`、`node_modules/`、`.mcp-runtime/`。
- PR 尽量小而聚焦。
- 行为变更需要新增或更新测试。
- 修改用户可见能力时，公开文档尽量保持中英双语。
- 保持 Windows Codex App、Windows Codex CLI、Linux Codex CLI 兼容。

## Code Style / 代码风格

- TypeScript source lives in `src/`.
- Tests live in `tests/` and use Vitest.
- The MCP server must only write protocol payloads to stdout. Logs belong in `.mcp-runtime/`.
- External story skills are read as text and must never be executed.

- TypeScript 源码位于 `src/`。
- 测试位于 `tests/`，使用 Vitest。
- MCP server 的 stdout 只能输出协议内容，日志写入 `.mcp-runtime/`。
- 外部 story skill 只能作为文本读取，不能执行。

## Pull Request Checklist / PR 检查项

- `npm test` passes.
- `npm run build` passes.
- No secrets or local absolute paths are committed.
- README or examples are updated when public behavior changes.

- `npm test` 通过。
- `npm run build` 通过。
- 未提交密钥或本机绝对路径。
- 公开行为变化时同步更新 README 或示例。
