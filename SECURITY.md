# Security Policy / 安全策略

## Supported Versions / 支持版本

This project is pre-1.0. Security fixes target the default branch until stable releases are published.

本项目仍处于 1.0 之前。稳定版本发布前，安全修复以默认分支为目标。

## Reporting / 报告问题

Do not post live API keys, private prompts, generated paid media, or private URLs in public issues.

请不要在公开 issue 中粘贴真实 API key、私有提示词、付费生成媒体或私有 URL。

If GitHub Security Advisories are enabled for this repository, use a private advisory. Otherwise, open a public issue with a redacted reproduction and clearly mark it as security-sensitive.

如果仓库启用了 GitHub Security Advisories，请使用私有 advisory。否则，请提交已脱敏的公开 issue，并明确标注安全敏感。

## Secret Handling / 密钥处理

- `ARK_API_KEY` must be provided by environment variables or local MCP client config.
- Tool arguments must not contain API keys.
- `check_runtime_config` only returns `hasApiKey`; it never echoes the key.
- `.env`, `.mcp-runtime/`, logs, outputs, and local Codex config files must not be committed.

- `ARK_API_KEY` 应通过环境变量或本机 MCP client 配置提供。
- 工具参数不应包含 API key。
- `check_runtime_config` 只返回 `hasApiKey`，不会回显 key。
- `.env`、`.mcp-runtime/`、日志、输出文件和本机 Codex 配置禁止提交。
