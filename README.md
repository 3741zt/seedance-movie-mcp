# Seedance Movie MCP / Seedance 视频生成 MCP

Seedance Movie MCP is a local stdio MCP server for Volcengine Ark Seedance/Jimeng video generation. It turns a story or long text into scene prompts, runs bounded parallel video tasks, downloads clips, concatenates the result with ffmpeg, and writes a manifest that Codex or other video tools can use for later editing.

Seedance Movie MCP 是一个本地 stdio MCP Server，用于接入火山方舟 Seedance/即梦视频生成任务接口。它可以把剧情或长文本拆成分镜提示词，并行生成视频片段，下载 mp4，用 ffmpeg 拼接，并输出可交给 Codex 或其他视频插件继续剪辑的 manifest。

## Highlights / 功能亮点

- Runtime config comes from environment variables: `ARK_API_KEY`, `ARK_MODEL`, `ARK_BASE_URL`, `ARK_MAX_CONCURRENCY`, `FFMPEG_PATH`.
- API keys are not tool parameters, so they do not need to enter chat context.
- `generate_movie` and `generate_movie_from_text` run scenes through a bounded parallel pool. Default concurrency is `3`; accepted range is `1-5`.
- `subtitleMode` supports `none`, `manifest`, and `burn`. Manifest mode avoids re-encoding; burn mode writes ASS subtitles and burns them with ffmpeg.
- Story splitting defaults to `witty_compact`, a humorous and tight narrative style. You can also pass a local Markdown/text story skill with `storySkillPath` or `SEEDANCE_STORY_SKILL_PATH`.
- A project-local Node.js runtime can be installed into `.mcp-runtime` so Codex Desktop, Codex CLI on Windows, and Codex CLI on Linux do not depend on the system Node version.
- The server outputs `sceneResults`, `parallel`, `subtitleTimeline`, and `manifestPath` so later editing tools can package clips, titles, transitions, captions, and subtitles.

- 运行时配置来自环境变量：`ARK_API_KEY`、`ARK_MODEL`、`ARK_BASE_URL`、`ARK_MAX_CONCURRENCY`、`FFMPEG_PATH`。
- API key 不作为工具参数传入，避免进入聊天上下文或工具日志。
- `generate_movie` / `generate_movie_from_text` 使用有上限的并行池处理分镜，默认并发 `3`，允许范围 `1-5`。
- `subtitleMode` 支持 `none`、`manifest`、`burn`。`manifest` 不重编码视频，`burn` 会生成 ASS 字幕并用 ffmpeg 烧录。
- 本地分镜默认采用 `witty_compact`，强调诙谐、幽默、紧凑；也支持通过 `storySkillPath` 或 `SEEDANCE_STORY_SKILL_PATH` 读取外部 Markdown/text 叙事 skill。
- 安装脚本可把 Node.js 安装到项目内 `.mcp-runtime`，兼容 Windows Codex App、Windows Codex CLI、Linux Codex CLI。
- 返回 `sceneResults`、`parallel`、`subtitleTimeline`、`manifestPath`，方便后续交给 Codex 或视频插件继续做片头、转场、字幕包装。

## Requirements / 环境要求

- Node.js `>=20.12` if you run with your system Node. The installer can also install project-local Node.js `v24.16.0`.
- npm.
- ffmpeg. If `FFMPEG_PATH` is not set, the server tries `ffmpeg-static`, then falls back to `ffmpeg` from `PATH`.
- A Volcengine Ark API key with video generation access.

- 如果使用系统 Node，需要 Node.js `>=20.12`。安装脚本也可以安装项目内 Node.js `v24.16.0`。
- 需要 npm。
- 需要 ffmpeg。未设置 `FFMPEG_PATH` 时，会优先使用 `ffmpeg-static`，再回退到 `PATH` 中的 `ffmpeg`。
- 需要具备视频生成权限的火山方舟 API key。

## Quick Start / 快速开始

```bash
git clone <your-repo-url>
cd seedance-movie-mcp
npm install
npm test
npm run build
```

Set your API key outside the repository:

在仓库外设置 API key：

```bash
export ARK_API_KEY="your-volcengine-ark-api-key"
```

```powershell
$env:ARK_API_KEY = "your-volcengine-ark-api-key"
```

Run a dry-run example that does not call Ark:

运行不会调用 Ark 的 dry-run 示例：

```bash
npm run example:dry-run
```

## Install Into Codex / 安装到 Codex

### Windows Codex App / Windows Codex CLI

```powershell
cd "C:\path\to\seedance-movie-mcp"
powershell -ExecutionPolicy Bypass -File .\scripts\install-codex.ps1
```

Update later from a git checkout:

后续从 git 仓库更新并重新安装：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-codex.ps1 -UpdateSource
```

### Linux Codex CLI

```bash
cd /path/to/seedance-movie-mcp
bash scripts/install-codex.sh
```

Update later from a git checkout:

后续从 git 仓库更新并重新安装：

```bash
bash scripts/install-codex.sh --update-source
```

The install scripts:

安装脚本会：

- install or reuse project-local Node.js in `.mcp-runtime`;
- run `npm install` and `npm run build`;
- back up and update Codex `config.toml`;
- register `mcp_servers.seedance-movie`;
- run `scripts/start-mcp.mjs --check`.

- 在 `.mcp-runtime` 安装或复用项目内 Node.js；
- 执行 `npm install` 和 `npm run build`；
- 备份并更新 Codex `config.toml`；
- 写入 `mcp_servers.seedance-movie`；
- 执行 `scripts/start-mcp.mjs --check`。

The scripts do not write `ARK_API_KEY`. Put the key in your user environment, shell session, or local Codex config.

安装脚本不会写入 `ARK_API_KEY`。请把 key 放到用户环境变量、当前 shell 会话或本机 Codex 配置中。

## Manual MCP Config / 手动 MCP 配置

Use the launcher script as the stdio command target. It installs dependencies and rebuilds when needed without writing to stdout, so the MCP protocol stays clean.

推荐把启动脚本作为 stdio 命令目标。它会在需要时自动安装依赖和重新构建，同时不污染 stdout，避免破坏 MCP 协议。

```toml
[mcp_servers.seedance-movie]
type = "stdio"
command = "node"
args = ["/path/to/seedance-movie-mcp/scripts/start-mcp.mjs"]
startup_timeout_sec = 120

[mcp_servers.seedance-movie.env]
ARK_MODEL = "doubao-seedance-2-0-260128"
ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
ARK_MAX_CONCURRENCY = "3"
FFMPEG_PATH = "ffmpeg"
# Prefer setting ARK_API_KEY as an environment variable.
# ARK_API_KEY = "your-volcengine-ark-api-key"
# Optional:
# SEEDANCE_STORY_SKILL_PATH = "/path/to/story-skill.md"
```

If you installed the project-local Node runtime, use the generated `node` path in `.mcp-runtime` as `command`.

如果安装了项目内 Node runtime，可以把 `.mcp-runtime` 里的 `node` 路径作为 `command`。

## Environment Variables / 环境变量

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ARK_API_KEY` | Yes for real generation | none | Volcengine Ark API key. Never commit it. |
| `ARK_MODEL` | No | `doubao-seedance-2-0-260128` | Default model. Tool-level `model` can override it per call. |
| `ARK_BASE_URL` | No | `https://ark.cn-beijing.volces.com/api/v3` | Ark API base URL. |
| `ARK_MAX_CONCURRENCY` | No | `3` | Default parallelism, clamped to `1-5`. |
| `FFMPEG_PATH` | No | `ffmpeg-static` or `ffmpeg` | ffmpeg executable path. |
| `SEEDANCE_STORY_SKILL_PATH` | No | none | External story skill text file. Read only; never executed. |

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `ARK_API_KEY` | 真实生成时必填 | 无 | 火山方舟 API key，禁止提交到仓库。 |
| `ARK_MODEL` | 否 | `doubao-seedance-2-0-260128` | 默认模型，单次工具调用可用 `model` 覆盖。 |
| `ARK_BASE_URL` | 否 | `https://ark.cn-beijing.volces.com/api/v3` | Ark API base URL。 |
| `ARK_MAX_CONCURRENCY` | 否 | `3` | 默认并发数，限制在 `1-5`。 |
| `FFMPEG_PATH` | 否 | `ffmpeg-static` 或 `ffmpeg` | ffmpeg 可执行文件路径。 |
| `SEEDANCE_STORY_SKILL_PATH` | 否 | 无 | 外部叙事 skill 文本文件。只读取，不执行。 |

## Tools / MCP 工具

- `check_runtime_config`: returns `hasApiKey`, `model`, `baseUrl`, `ffmpegPath`, and `maxConcurrency` without exposing the key.
- `split_story_to_scenes`: turns a story into stable scene prompts.
- `infer_text_to_scenes`: turns long text or an article into scene prompts inside the MCP process.
- `plan_reference_images`: plans Codex-side image prompts without calling any image or video API.
- `estimate_movie_cost`: estimates video length, token usage, and rough CNY cost without HTTP calls.
- `generate_scene_video`: creates one Ark video task and returns `taskId`.
- `get_video_task`: queries a task and returns status, video URL, and error details.
- `wait_video_task`: polls until a terminal status or timeout.
- `download_video`: downloads an mp4 to the local output directory.
- `concat_videos`: concatenates local clips with ffmpeg.
- `generate_movie`: full story-to-video flow.
- `generate_movie_from_text`: token-saving text-to-video flow; detailed prompts stay inside the MCP process unless `returnPrompts` is true.

- `check_runtime_config`：返回 `hasApiKey`、`model`、`baseUrl`、`ffmpegPath`、`maxConcurrency`，不回显 key。
- `split_story_to_scenes`：把剧情拆成稳定分镜提示词。
- `infer_text_to_scenes`：在 MCP 进程内把长文本或文章推理成分镜。
- `plan_reference_images`：规划 Codex 侧参考图提示词，不调用图片或视频 API。
- `estimate_movie_cost`：估算视频时长、token 和人民币成本，不发送 HTTP 请求。
- `generate_scene_video`：创建单段 Ark 视频任务，返回 `taskId`。
- `get_video_task`：查询任务状态、视频 URL 和错误信息。
- `wait_video_task`：轮询到终态或超时。
- `download_video`：把 mp4 下载到本地输出目录。
- `concat_videos`：用 ffmpeg 拼接本地片段。
- `generate_movie`：剧情到完整视频的一键流程。
- `generate_movie_from_text`：省上下文的文本到视频流程；除非 `returnPrompts=true`，详细提示词只留在 MCP 内部。

## Parallel Generation / 并行生成

`generate_movie` and `generate_movie_from_text` process each scene independently: cache lookup, task creation, polling, download, and cache write. Results are returned in scene order even when tasks finish out of order.

`generate_movie` 和 `generate_movie_from_text` 会对每个分镜独立执行：查缓存、创建任务、轮询、下载、写缓存。即使任务完成顺序不同，返回结果也会按分镜顺序排列。

```json
{
  "text": "A tired office worker announces they will sleep early. The coffee machine starts by itself.",
  "sceneCount": 4,
  "secondsPerScene": 5,
  "ratio": "9:16",
  "maxConcurrency": 3,
  "subtitleMode": "manifest",
  "returnPrompts": false
}
```

On failure, the server stops scheduling new scenes, waits for already-started work to settle, returns partial `sceneResults`, and does not concatenate an incomplete final movie.

如果某个分镜失败，服务会停止调度新分镜，等待已启动任务收尾，返回部分 `sceneResults`，不会拼接错误的不完整成片。

## Subtitles And Manifest / 字幕与 Manifest

`subtitleMode`:

- `none`: no subtitle timeline.
- `manifest`: default. Returns `subtitleTimeline` and writes a manifest without re-encoding video.
- `burn`: writes ASS subtitles and burns them into a second output video.

`subtitleMode`：

- `none`：不生成字幕时间轴。
- `manifest`：默认值。返回 `subtitleTimeline` 并写 manifest，不重编码视频。
- `burn`：写 ASS 字幕，并烧录生成第二个带字幕视频。

If `subtitles` is omitted, each scene beat becomes the subtitle text. `outputManifestFileName` can override the manifest filename.

未传 `subtitles` 时，会使用每个分镜的 beat 作为字幕。`outputManifestFileName` 可以覆盖 manifest 文件名。

## Story Skills / 叙事 Skill

Built-in styles:

- `witty_compact`: default, humorous, compact, conflict-first short-video storytelling.
- `cinematic_default`: legacy cinematic style for more serious stories.

内置风格：

- `witty_compact`：默认值，诙谐、紧凑、先冲突后解释，适合短视频。
- `cinematic_default`：旧版电影感风格，适合更严肃的叙事。

External story skills are plain text. The server strips Markdown fences, caps injected length, and never executes the file.

外部 story skill 是普通文本。服务会去掉 Markdown 代码围栏并限制注入长度，永远不会执行文件内容。

```json
{
  "text": "Paste an article, brief, product description, or story here.",
  "storySkillPath": "/path/to/my-story-skill.md"
}
```

Template files:

- `skills/witty-compact.md`
- `skills/cinematic-default.md`

## Development / 开发

```bash
npm install
npm test
npm run build
node scripts/start-mcp.mjs --check
```

Test coverage includes runtime config parsing, Ark retry behavior, bounded parallel ordering, cache reuse, partial failure behavior, subtitle timeline generation, ASS escaping, story skills, reference media handling, and ffmpeg concat escaping.

测试覆盖运行时配置解析、Ark 重试、并发池顺序、缓存复用、部分失败、字幕时间轴、ASS 转义、叙事 skill、参考素材和 ffmpeg concat 路径转义。

## Safety / 安全边界

- Do not commit API keys, tokens, private prompts, generated paid media, or local Codex config.
- `outputs/`, `.mcp-runtime/`, `dist/`, `node_modules/`, logs, and `.env` are ignored.
- The server only uses official Ark video-generation task APIs. Do not reverse-engineer web clients.
- Reference image/video/audio inputs must be public HTTP(S) URLs accepted by Ark.

- 不要提交 API key、token、私有提示词、付费生成媒体或本机 Codex 配置。
- `outputs/`、`.mcp-runtime/`、`dist/`、`node_modules/`、日志和 `.env` 已加入忽略。
- 本项目只使用官方 Ark 视频生成任务接口，不逆向网页端。
- 参考图片、视频、音频必须是 Ark 可访问的公网 HTTP(S) URL。

## License / 许可证

MIT. See `LICENSE`. 中文非正式译文见 `LICENSE.zh-CN.md`。
