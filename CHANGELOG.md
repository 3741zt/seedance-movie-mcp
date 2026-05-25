# Changelog / 更新日志

All notable changes to this project will be documented here.

本项目的重要变更会记录在这里。

## 0.1.0 - 2026-05-25

- Added Codex env runtime config for Ark API key, model, base URL, ffmpeg, and concurrency.
- Added `check_runtime_config` without API key disclosure.
- Added bounded parallel generation for movie flows.
- Added subtitle manifest timeline and optional ASS burn-in.
- Added Ark retry behavior for `429` and `5xx` responses.
- Added local Node.js runtime installer and cross-platform Codex install scripts.
- Added built-in and external story skill support.
- Added open-source docs, examples, and security guidance.

- 增加 Codex env 运行时配置，支持 Ark API key、模型、base URL、ffmpeg 和并发数。
- 增加不泄露 API key 的 `check_runtime_config`。
- 为完整视频流程增加有上限的并行生成。
- 增加字幕 manifest 时间轴和可选 ASS 烧录。
- 为 Ark `429` 和 `5xx` 响应增加重试。
- 增加项目内 Node.js runtime 安装和跨平台 Codex 安装脚本。
- 增加内置与外部 story skill 支持。
- 增加开源文档、示例和安全说明。
