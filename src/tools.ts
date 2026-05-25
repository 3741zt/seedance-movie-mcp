import {
  createArkClientFromEnv,
  normalizeReferenceMedia,
  type ArkVideoClient,
  type CreateTaskInput,
  type ReferenceMedia,
  type ReferenceMediaType,
  type VideoTaskResult
} from "./ark.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyProfileToArticleInput,
  applyProfileToSplitStoryInput,
  estimateVideoUsage,
  getQualityProfileSettings,
  isEstimatedCostOverLimit,
  type QualityProfileSettings,
  type VideoUsageEstimate
} from "./budget.js";
import {
  buildVideoRequestCacheKey,
  getCachedVideoEntry,
  getUsableCachedClip,
  rememberVideoClip,
  rememberVideoTask
} from "./cache.js";
import { DEFAULT_OUTPUT_DIR, getRuntimeConfig, normalizeMaxConcurrency } from "./config.js";
import { buildSubtitleTimeline, burnSubtitles, concatVideos, writeAssSubtitleFile } from "./ffmpeg.js";
import { downloadVideo } from "./files.js";
import { runBoundedParallel } from "./parallel.js";
import { buildReferenceImagePrompts } from "./referenceImages.js";
import { getComplianceError } from "./safety.js";
import { splitArticleToScenes, splitStoryToScenes, summarizeScenes, type ScenePrompt } from "./story.js";

type JsonRecord = Record<string, unknown>;

export const TOOL_DEFINITIONS = [
  {
    name: "check_runtime_config",
    description: "Check Seedance MCP runtime configuration without exposing API keys.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "split_story_to_scenes",
    description: "Split a story into stable cinematic Seedance scene prompts.",
    inputSchema: {
      type: "object",
      properties: {
        story: { type: "string", description: "剧情文本" },
        sceneCount: { type: "number", description: "分镜数量，默认 3，最多 8" },
        secondsPerScene: { type: "number", description: "每段秒数，自动限制在 4-15 秒" },
        ratio: { type: "string", description: "画幅比例，例如 16:9 或 9:16" },
        style: { type: "string", description: "统一视觉风格" },
        character: { type: "string", description: "人物一致性描述" },
        narrativeStyle: {
          type: "string",
          description: "叙事风格：witty_compact=诙谐紧凑，cinematic_default=旧版电影感"
        },
        storySkillPath: { type: "string", description: "外部叙事 skill Markdown/文本文件路径，只读取文本不执行代码" }
      },
      required: ["story"]
    }
  },
  {
    name: "infer_text_to_scenes",
    description:
      "Infer cinematic scene prompts from a long article or plain text inside the MCP process. Use returnPrompts=false to save chat tokens.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "文章、资料、剧情或长文本" },
        article: { type: "string", description: "text 的别名，适合直接传文章" },
        sceneCount: { type: "number", description: "分镜数量，默认自动推理，最多 8" },
        secondsPerScene: { type: "number", description: "每段秒数，自动限制在 4-15 秒" },
        ratio: { type: "string", description: "画幅比例，例如 16:9 或 9:16" },
        style: { type: "string", description: "可选。不给则 MCP 根据文本推理统一视觉风格" },
        character: { type: "string", description: "可选。不给则 MCP 根据文本推理人物/主体一致性" },
        audience: { type: "string", description: "目标观众，默认短视频观众" },
        visualGoal: { type: "string", description: "视觉目标，默认由 MCP 根据文本推理" },
        narrativeStyle: {
          type: "string",
          description: "叙事风格：witty_compact=诙谐紧凑，cinematic_default=旧版电影感"
        },
        storySkillPath: { type: "string", description: "外部叙事 skill Markdown/文本文件路径，只读取文本不执行代码" },
        referenceImageUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考图片 URL。MCP 会在内部提示词中按 图片1、图片2 绑定"
        },
        referenceVideoUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考视频 URL。MCP 会在内部提示词中按 视频1、视频2 绑定"
        },
        referenceAudioUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考音频 URL。MCP 会在内部提示词中按 音频1、音频2 绑定"
        },
        references: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "image_url、video_url 或 audio_url" },
              url: { type: "string", description: "公网可访问素材 URL" },
              role: { type: "string", description: "默认 reference_image/reference_video/reference_audio" }
            },
            required: ["type", "url"]
          },
          description: "通用参考素材数组"
        },
        returnPrompts: { type: "boolean", description: "是否返回完整提示词，默认 false 以节约上下文 token" }
      },
      required: []
    }
  },
  {
    name: "plan_reference_images",
    description:
      "Plan Codex-side reference images from article/text. This tool does not call any image API or Volcengine video API.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "文章、产品介绍、剧情或关键内容" },
        article: { type: "string", description: "text 的别名" },
        imageCount: { type: "number", description: "计划图片数量，默认 2，最多 4" },
        ratio: { type: "string", description: "画幅比例，用于推荐图片尺寸，默认 16:9" },
        style: { type: "string", description: "图片视觉风格" },
        product: { type: "string", description: "主体或产品描述" },
        returnPrompts: { type: "boolean", description: "兼容字段。该 tool 始终返回图片提示词" }
      },
      required: []
    }
  },
  {
    name: "estimate_movie_cost",
    description:
      "Estimate Seedance/Jimeng video generation cost before calling the video API. This tool never sends HTTP requests to Ark.",
    inputSchema: {
      type: "object",
      properties: {
        story: { type: "string", description: "剧情文本。和 text/article 二选一" },
        text: { type: "string", description: "文章、资料、剧情或长文本" },
        article: { type: "string", description: "text 的别名" },
        sceneCount: { type: "number", description: "分镜数量，默认按 qualityProfile 推断，最多 8" },
        secondsPerScene: { type: "number", description: "每段秒数，默认按 qualityProfile 推断" },
        ratio: { type: "string", description: "画幅比例，例如 16:9 或 9:16" },
        style: { type: "string", description: "统一视觉风格" },
        character: { type: "string", description: "人物/主体一致性描述" },
        audience: { type: "string", description: "目标观众" },
        visualGoal: { type: "string", description: "视觉目标" },
        narrativeStyle: {
          type: "string",
          description: "叙事风格：witty_compact=诙谐紧凑，cinematic_default=旧版电影感"
        },
        storySkillPath: { type: "string", description: "外部叙事 skill Markdown/文本文件路径，只读取文本不执行代码" },
        qualityProfile: {
          type: "string",
          description: "cheap_preview=省钱预览，draft_movie=完整草稿，final_1080p=正式 1080p，默认 final_1080p"
        },
        resolution: { type: "string", description: "覆盖 profile 的分辨率，例如 720p 或 1080p" },
        referenceVideoUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考视频 URL。含视频输入时会按较低公开视频输入场景估算"
        },
        references: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "image_url、video_url 或 audio_url" },
              url: { type: "string", description: "公网可访问素材 URL" },
              role: { type: "string", description: "默认 reference_image/reference_video/reference_audio" }
            },
            required: ["type", "url"]
          }
        },
        returnPrompts: { type: "boolean", description: "是否返回完整提示词，默认 false" }
      },
      required: []
    }
  },
  {
    name: "generate_scene_video",
    description: "Create one Seedance 2.0 video generation task and return taskId.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "单个分镜提示词" },
        duration: { type: "number", description: "视频时长，默认 5" },
        ratio: { type: "string", description: "画幅比例，默认 16:9" },
        resolution: { type: "string", description: "分辨率，默认 1080p" },
        qualityProfile: {
          type: "string",
          description: "可选：cheap_preview、draft_movie、final_1080p。未传 resolution 时按 profile 选分辨率"
        },
        dryRun: { type: "boolean", description: "true 时只返回请求计划和费用估算，不调用视频 API" },
        estimateOnly: { type: "boolean", description: "dryRun 的别名" },
        useCache: { type: "boolean", description: "是否复用相同 prompt+参数的历史任务，默认 true" },
        forceRegenerate: { type: "boolean", description: "true 时忽略缓存，强制创建新任务" },
        maxEstimatedCostCny: { type: "number", description: "费用粗估超过该人民币金额时拒绝创建任务" },
        generateAudio: { type: "boolean", description: "是否生成音频，默认 true" },
        watermark: { type: "boolean", description: "是否加水印，默认 false" },
        model: { type: "string", description: "模型名，默认 doubao-seedance-2-0-260128" },
        referenceImageUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考图片 URL，对应官方 content[].image_url"
        },
        referenceVideoUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考视频 URL，对应官方 content[].video_url"
        },
        referenceAudioUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考音频 URL，对应官方 content[].audio_url"
        },
        references: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "image_url、video_url 或 audio_url" },
              url: { type: "string", description: "公网可访问素材 URL" },
              role: { type: "string", description: "默认 reference_image/reference_video/reference_audio" }
            },
            required: ["type", "url"]
          },
          description: "通用参考素材数组"
        }
      },
      required: ["prompt"]
    }
  },
  {
    name: "get_video_task",
    description: "Query a Seedance task and return status, videoUrl, and error.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "任务 ID" }
      },
      required: ["taskId"]
    }
  },
  {
    name: "wait_video_task",
    description: "Poll a Seedance task until succeeded, failed, expired, cancelled, or timeout.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "任务 ID" },
        pollIntervalSeconds: { type: "number", description: "轮询间隔秒数，默认 30" },
        timeoutSeconds: { type: "number", description: "超时秒数，默认 1800" }
      },
      required: ["taskId"]
    }
  },
  {
    name: "download_video",
    description: "Download an mp4 video URL to the configured outputs directory.",
    inputSchema: {
      type: "object",
      properties: {
        videoUrl: { type: "string", description: "mp4 URL" },
        fileName: { type: "string", description: "保存文件名" }
      },
      required: ["videoUrl", "fileName"]
    }
  },
  {
    name: "concat_videos",
    description: "Concat local mp4 clips into a single mp4 with ffmpeg concat demuxer.",
    inputSchema: {
      type: "object",
      properties: {
        inputPaths: {
          type: "array",
          items: { type: "string" },
          description: "本地 mp4 路径数组"
        },
        outputFileName: { type: "string", description: "输出文件名，默认自动生成" }
      },
      required: ["inputPaths"]
    }
  },
  {
    name: "generate_movie",
    description:
      "One-shot flow: split story, create tasks, wait, immediately download each succeeded clip, and concat into one mp4.",
    inputSchema: {
      type: "object",
      properties: {
        story: { type: "string", description: "剧情文本" },
        sceneCount: { type: "number", description: "分镜数量，默认 3，最多 8" },
        secondsPerScene: { type: "number", description: "每段秒数，自动限制在 4-15 秒" },
        ratio: { type: "string", description: "画幅比例，例如 16:9 或 9:16" },
        style: { type: "string", description: "统一视觉风格" },
        character: { type: "string", description: "人物一致性描述" },
        narrativeStyle: {
          type: "string",
          description: "叙事风格：witty_compact=诙谐紧凑，cinematic_default=旧版电影感"
        },
        storySkillPath: { type: "string", description: "外部叙事 skill Markdown/文本文件路径，只读取文本不执行代码" },
        resolution: { type: "string", description: "分辨率，默认 1080p" },
        qualityProfile: {
          type: "string",
          description: "cheap_preview=最多3段/4秒/720p，draft_movie=完整720p草稿，final_1080p=正式1080p，默认 final_1080p"
        },
        dryRun: { type: "boolean", description: "true 时只拆分分镜并返回费用估算，不调用视频 API" },
        estimateOnly: { type: "boolean", description: "dryRun 的别名" },
        useCache: { type: "boolean", description: "是否复用相同 prompt+参数的本地片段或历史任务，默认 true" },
        forceRegenerate: { type: "boolean", description: "true 时忽略缓存，强制重新生成" },
        maxEstimatedCostCny: { type: "number", description: "费用粗估超过该人民币金额时拒绝创建任务" },
        generateAudio: { type: "boolean", description: "是否生成音频，默认 true" },
        watermark: { type: "boolean", description: "是否加水印，默认 false" },
        outputFileName: { type: "string", description: "最终拼接视频文件名" },
        pollIntervalSeconds: { type: "number", description: "轮询间隔秒数，默认 30" },
        timeoutSeconds: { type: "number", description: "每个任务超时秒数，默认 1800" },
        maxConcurrency: { type: "number", description: "并行生成上限，默认 3，允许 1-5" },
        subtitleMode: { type: "string", description: "字幕模式：none、manifest 或 burn，默认 manifest" },
        subtitles: {
          type: "array",
          items: { type: "string" },
          description: "可选。每个分镜对应一条字幕，不传则使用分镜 beat"
        },
        outputManifestFileName: { type: "string", description: "输出 manifest JSON 文件名" },
        returnPrompts: { type: "boolean", description: "是否返回完整提示词，默认 false 以节约上下文 token" },
        referenceImageUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考图片 URL，所有分镜都会带入"
        },
        referenceVideoUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考视频 URL，所有分镜都会带入"
        },
        referenceAudioUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考音频 URL，所有分镜都会带入"
        },
        references: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "image_url、video_url 或 audio_url" },
              url: { type: "string", description: "公网可访问素材 URL" },
              role: { type: "string", description: "默认 reference_image/reference_video/reference_audio" }
            },
            required: ["type", "url"]
          },
          description: "通用参考素材数组，所有分镜都会带入"
        }
      },
      required: ["story"]
    }
  },
  {
    name: "generate_movie_from_text",
    description:
      "Token-saving one-shot flow: accept article/text, infer detailed prompts inside MCP, call Seedance/Jimeng 2.0 API over HTTP, wait, download, and concat.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "文章、资料、剧情或长文本" },
        article: { type: "string", description: "text 的别名，适合直接传文章" },
        sceneCount: { type: "number", description: "分镜数量，默认自动推理，最多 8" },
        secondsPerScene: { type: "number", description: "每段秒数，自动限制在 4-15 秒" },
        ratio: { type: "string", description: "画幅比例，例如 16:9 或 9:16" },
        style: { type: "string", description: "可选。不给则 MCP 根据文本推理统一视觉风格" },
        character: { type: "string", description: "可选。不给则 MCP 根据文本推理人物/主体一致性" },
        audience: { type: "string", description: "目标观众，默认短视频观众" },
        visualGoal: { type: "string", description: "视觉目标，默认由 MCP 根据文本推理" },
        narrativeStyle: {
          type: "string",
          description: "叙事风格：witty_compact=诙谐紧凑，cinematic_default=旧版电影感"
        },
        storySkillPath: { type: "string", description: "外部叙事 skill Markdown/文本文件路径，只读取文本不执行代码" },
        resolution: { type: "string", description: "分辨率，默认 1080p" },
        qualityProfile: {
          type: "string",
          description: "cheap_preview=最多3段/4秒/720p，draft_movie=完整720p草稿，final_1080p=正式1080p，默认 final_1080p"
        },
        dryRun: { type: "boolean", description: "true 时只推理分镜并返回费用估算，不调用视频 API" },
        estimateOnly: { type: "boolean", description: "dryRun 的别名" },
        useCache: { type: "boolean", description: "是否复用相同 prompt+参数的本地片段或历史任务，默认 true" },
        forceRegenerate: { type: "boolean", description: "true 时忽略缓存，强制重新生成" },
        maxEstimatedCostCny: { type: "number", description: "费用粗估超过该人民币金额时拒绝创建任务" },
        generateAudio: { type: "boolean", description: "是否生成音频，默认 true" },
        watermark: { type: "boolean", description: "是否加水印，默认 false" },
        outputFileName: { type: "string", description: "最终拼接视频文件名" },
        pollIntervalSeconds: { type: "number", description: "轮询间隔秒数，默认 30" },
        timeoutSeconds: { type: "number", description: "每个任务超时秒数，默认 1800" },
        maxConcurrency: { type: "number", description: "并行生成上限，默认 3，允许 1-5" },
        subtitleMode: { type: "string", description: "字幕模式：none、manifest 或 burn，默认 manifest" },
        subtitles: {
          type: "array",
          items: { type: "string" },
          description: "可选。每个分镜对应一条字幕，不传则使用分镜 beat"
        },
        outputManifestFileName: { type: "string", description: "输出 manifest JSON 文件名" },
        referenceImageUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考图片 URL。MCP 内部按 图片1、图片2 写入提示词，并放进官方 content"
        },
        referenceVideoUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考视频 URL。MCP 内部按 视频1、视频2 写入提示词，并放进官方 content"
        },
        referenceAudioUrls: {
          type: "array",
          items: { type: "string" },
          description: "可选参考音频 URL。MCP 内部按 音频1、音频2 写入提示词，并放进官方 content"
        },
        references: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "image_url、video_url 或 audio_url" },
              url: { type: "string", description: "公网可访问素材 URL" },
              role: { type: "string", description: "默认 reference_image/reference_video/reference_audio" }
            },
            required: ["type", "url"]
          },
          description: "通用参考素材数组"
        },
        returnPrompts: { type: "boolean", description: "是否返回完整提示词，默认 false 以节约上下文 token" }
      },
      required: []
    }
  }
] as const;

export async function callTool(name: string, rawArgs: unknown): Promise<unknown> {
  const args = asRecord(rawArgs);

  switch (name) {
    case "check_runtime_config":
      return checkRuntimeConfigTool();
    case "split_story_to_scenes":
      return splitStoryTool(args);
    case "infer_text_to_scenes":
      return inferTextTool(args);
    case "plan_reference_images":
      return planReferenceImagesTool(args);
    case "estimate_movie_cost":
      return estimateMovieCostTool(args);
    case "generate_scene_video":
      return generateSceneVideoTool(args);
    case "get_video_task":
      return getVideoTaskTool(args);
    case "wait_video_task":
      return waitVideoTaskTool(args);
    case "download_video":
      return downloadVideoTool(args);
    case "concat_videos":
      return concatVideosTool(args);
    case "generate_movie":
      return generateMovieTool(args);
    case "generate_movie_from_text":
      return generateMovieFromTextTool(args);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export function isErrorResult(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && "error" in result);
}

function checkRuntimeConfigTool(): Record<string, unknown> {
  const config = getRuntimeConfig();
  return {
    hasApiKey: config.hasApiKey,
    model: config.model,
    baseUrl: config.baseUrl,
    ffmpegPath: config.ffmpegPath,
    maxConcurrency: config.maxConcurrency
  };
}

function splitStoryTool(args: JsonRecord): ScenePrompt[] | { error: string } {
  const input = readSplitStoryInput(args);
  const complianceError = getComplianceError([input.story, input.character, input.style].filter(Boolean).join(" "));
  if (complianceError) {
    return { error: complianceError };
  }

  return splitStoryToScenes(input);
}

function inferTextTool(args: JsonRecord): unknown {
  const input = readArticleInput(args);
  const references = readReferences(args);
  const complianceError = getComplianceError([input.text, input.character, input.style].filter(Boolean).join(" "));
  if (complianceError) {
    return { error: complianceError };
  }

  const scenes = applyReferencesToScenes(splitArticleToScenes(input), references);
  return {
    scenes: summarizeScenes(scenes, optionalBoolean(args, "returnPrompts") ?? false),
    promptMode: "local-inference",
    note: "Full prompts are generated inside MCP. Set returnPrompts=true only when you need to inspect them."
  };
}

function planReferenceImagesTool(args: JsonRecord): unknown {
  const text = optionalString(args, "text") ?? requiredString(args, "article");
  const complianceError = getComplianceError([text, optionalString(args, "product"), optionalString(args, "style")].filter(Boolean).join(" "));
  if (complianceError) {
    return { error: complianceError };
  }

  const prompts = buildReferenceImagePrompts({
    text,
    imageCount: optionalNumber(args, "imageCount"),
    style: optionalString(args, "style"),
    ratio: optionalString(args, "ratio"),
    product: optionalString(args, "product")
  });

  return {
    imagePrompts: prompts,
    promptMode: "codex-image-generation",
    note:
      "MCP does not call any image API. Generate these images with Codex in the app, then upload them to public storage if they must be passed to Ark referenceImageUrls."
  };
}

function estimateMovieCostTool(args: JsonRecord): unknown {
  const profile = getQualityProfileSettings(optionalString(args, "qualityProfile"));
  const references = readReferences(args);
  const usesStory = Boolean(optionalString(args, "story"));
  const scenes = usesStory
    ? splitStoryToScenes(applyProfileToSplitStoryInput(readSplitStoryInput(args), profile))
    : applyReferencesToScenes(splitArticleToScenes(applyProfileToArticleInput(readArticleInput(args), profile)), references);
  const resolution = optionalString(args, "resolution") ?? profile.resolution;
  const estimate = estimateVideoUsage(scenes, { resolution, references });

  return {
    scenes: summarizeScenes(scenes, optionalBoolean(args, "returnPrompts") ?? false),
    qualityProfile: profile,
    estimate,
    plannedOnly: true,
    note: "No Ark HTTP request was sent. Use cheap_preview/draft_movie first, then final_1080p only after prompts are confirmed."
  };
}

async function generateSceneVideoTool(args: JsonRecord): Promise<unknown> {
  const prompt = requiredString(args, "prompt");
  const references = readReferences(args);
  const complianceError = getComplianceError(prompt);
  if (complianceError) {
    return { error: complianceError };
  }

  const profile = getQualityProfileSettings(optionalString(args, "qualityProfile"));
  const createInput = {
    prompt: appendReferenceBinding(prompt, references),
    duration: optionalNumber(args, "duration") ?? profile.secondsPerScene,
    ratio: optionalString(args, "ratio") ?? "16:9",
    resolution: optionalString(args, "resolution") ?? profile.resolution,
    generateAudio: optionalBoolean(args, "generateAudio") ?? profile.generateAudio,
    watermark: optionalBoolean(args, "watermark"),
    model: optionalString(args, "model"),
    references
  };
  const estimate = estimateVideoUsage([{ duration: createInput.duration }], {
    resolution: createInput.resolution,
    references
  });
  const cacheKey = buildVideoRequestCacheKey(createInput);

  if (isDryRun(args)) {
    return {
      plannedOnly: true,
      cacheKey,
      request: summarizeCreateInput(createInput),
      qualityProfile: profile,
      estimate
    };
  }

  const maxEstimatedCostCny = optionalNumber(args, "maxEstimatedCostCny");
  if (isEstimatedCostOverLimit(estimate, maxEstimatedCostCny)) {
    return {
      error: `Estimated cost ${estimate.estimatedCostCny} CNY is over maxEstimatedCostCny ${maxEstimatedCostCny}. No video API request was sent.`,
      cacheKey,
      request: summarizeCreateInput(createInput),
      estimate
    };
  }

  if (shouldUseCache(args)) {
    const cached = await getCachedVideoEntry(cacheKey);
    if (cached?.taskId) {
      return {
        taskId: cached.taskId,
        cached: true,
        cacheKey,
        estimate
      };
    }
  }

  const { client, error } = createArkClientFromEnv();
  if (!client) {
    return { error };
  }

  const taskId = await client.createTask(createInput);
  await rememberVideoTask(cacheKey, taskId);

  return { taskId, cached: false, cacheKey, estimate };
}

async function getVideoTaskTool(args: JsonRecord): Promise<unknown> {
  const { client, error } = createArkClientFromEnv();
  if (!client) {
    return { error };
  }
  return client.getTask(requiredString(args, "taskId"));
}

async function waitVideoTaskTool(args: JsonRecord): Promise<unknown> {
  const { client, error } = createArkClientFromEnv();
  if (!client) {
    return { error };
  }

  return client.waitTask(requiredString(args, "taskId"), {
    pollIntervalMs: secondsToMs(optionalNumber(args, "pollIntervalSeconds") ?? 30),
    timeoutMs: secondsToMs(optionalNumber(args, "timeoutSeconds") ?? 1800)
  });
}

async function downloadVideoTool(args: JsonRecord): Promise<{ videoPath?: string; error?: string }> {
  return {
    videoPath: await downloadVideo({
      videoUrl: requiredString(args, "videoUrl"),
      fileName: requiredString(args, "fileName")
    })
  };
}

async function concatVideosTool(args: JsonRecord): Promise<{ finalVideoPath?: string; error?: string }> {
  return {
    finalVideoPath: await concatVideos({
      inputPaths: stringArray(args, "inputPaths"),
      outputFileName: optionalString(args, "outputFileName")
    })
  };
}

async function generateMovieTool(args: JsonRecord): Promise<unknown> {
  const profile = getQualityProfileSettings(optionalString(args, "qualityProfile"));
  const splitInput = applyProfileToSplitStoryInput(readSplitStoryInput(args), profile);
  const references = readReferences(args);
  const complianceError = getComplianceError([splitInput.story, splitInput.character, splitInput.style].filter(Boolean).join(" "));
  if (complianceError) {
    return { error: complianceError };
  }

  const scenes = splitStoryToScenes(splitInput);
  const resolution = optionalString(args, "resolution") ?? profile.resolution;
  const generateAudio = optionalBoolean(args, "generateAudio") ?? profile.generateAudio;
  const estimate = estimateVideoUsage(scenes, { resolution, references });
  const plan = {
    scenes,
    qualityProfile: profile,
    estimate,
    promptMode: "story-split"
  };

  if (isDryRun(args)) {
    return {
      ...plan,
      scenes: summarizeScenes(scenes, optionalBoolean(args, "returnPrompts") ?? false),
      plannedOnly: true,
      note: "No Ark HTTP request was sent."
    };
  }

  const maxEstimatedCostCny = optionalNumber(args, "maxEstimatedCostCny");
  if (isEstimatedCostOverLimit(estimate, maxEstimatedCostCny)) {
    return {
      ...plan,
      scenes: summarizeScenes(scenes, optionalBoolean(args, "returnPrompts") ?? false),
      taskIds: [],
      clipPaths: [],
      error: `Estimated cost ${estimate.estimatedCostCny} CNY is over maxEstimatedCostCny ${maxEstimatedCostCny}. No video API request was sent.`
    };
  }

  const { client, error } = createArkClientFromEnv();
  if (!client) {
    return {
      scenes: summarizeScenes(scenes, optionalBoolean(args, "returnPrompts") ?? false),
      taskIds: [],
      clipPaths: [],
      qualityProfile: profile,
      estimate,
      error
    };
  }

  return runSceneMovieFlow({
    args,
    scenes,
    references,
    resolution,
    generateAudio,
    profile,
    estimate,
    promptMode: "story-split",
    returnPrompts: optionalBoolean(args, "returnPrompts") ?? false,
    client
  });
}

async function generateMovieFromTextTool(args: JsonRecord): Promise<unknown> {
  const profile = getQualityProfileSettings(optionalString(args, "qualityProfile"));
  const articleInput = applyProfileToArticleInput(readArticleInput(args), profile);
  const references = readReferences(args);
  const complianceError = getComplianceError([articleInput.text, articleInput.character, articleInput.style].filter(Boolean).join(" "));
  if (complianceError) {
    return { error: complianceError };
  }

  const scenes = splitArticleToScenes(articleInput);
  const resolution = optionalString(args, "resolution") ?? profile.resolution;
  const generateAudio = optionalBoolean(args, "generateAudio") ?? profile.generateAudio;
  const estimate = estimateVideoUsage(scenes, { resolution, references });
  const compactScenes = summarizeScenes(scenes, optionalBoolean(args, "returnPrompts") ?? false);

  if (isDryRun(args)) {
    return {
      scenes: compactScenes,
      taskIds: [],
      clipPaths: [],
      qualityProfile: profile,
      estimate,
      promptMode: "local-inference",
      plannedOnly: true,
      note: "No Ark HTTP request was sent."
    };
  }

  const maxEstimatedCostCny = optionalNumber(args, "maxEstimatedCostCny");
  if (isEstimatedCostOverLimit(estimate, maxEstimatedCostCny)) {
    return {
      scenes: compactScenes,
      taskIds: [],
      clipPaths: [],
      qualityProfile: profile,
      estimate,
      promptMode: "local-inference",
      error: `Estimated cost ${estimate.estimatedCostCny} CNY is over maxEstimatedCostCny ${maxEstimatedCostCny}. No video API request was sent.`
    };
  }

  const { client, error } = createArkClientFromEnv();
  if (!client) {
    return {
      scenes: compactScenes,
      taskIds: [],
      clipPaths: [],
      qualityProfile: profile,
      estimate,
      promptMode: "local-inference",
      error
    };
  }

  return runSceneMovieFlow({
    args,
    scenes,
    references,
    resolution,
    generateAudio,
    profile,
    estimate,
    promptMode: "local-inference",
    returnPrompts: optionalBoolean(args, "returnPrompts") ?? false,
    client
  });
}

async function runSceneMovieFlow(input: {
  args: JsonRecord;
  scenes: ScenePrompt[];
  references: ReferenceMedia[];
  resolution: string;
  generateAudio: boolean;
  profile: QualityProfileSettings;
  estimate: VideoUsageEstimate;
  promptMode: string;
  returnPrompts: boolean;
  client: ArkVideoClient;
}): Promise<unknown> {
  const maxConcurrency = normalizeMaxConcurrency(optionalNumber(input.args, "maxConcurrency"));
  const subtitleMode = readSubtitleMode(input.args);
  const subtitleTimeline =
    subtitleMode === "none" ? [] : buildSubtitleTimeline(buildSubtitleSceneInputs(input.args, input.scenes));
  const sceneResults: Array<SceneGenerationResult | undefined> = Array.from({ length: input.scenes.length });

  await runBoundedParallel(input.scenes, maxConcurrency, async (scene, index) => {
    const result = await runSingleSceneGeneration(input, scene, index);
    sceneResults[index] = result;
    if (result.error) {
      throw new Error(result.error);
    }
    return result;
  });

  const orderedSceneResults = sceneResults.map(
    (result, index): SceneGenerationResult =>
      result ?? {
        sceneId: input.scenes[index]!.id,
        status: "skipped",
        cached: false,
        error: "Skipped because an earlier scene failed before this scene was scheduled"
      }
  );
  const taskIds = orderedSceneResults.map((result) => result.taskId).filter((taskId): taskId is string => Boolean(taskId));
  const clipPaths = orderedSceneResults
    .filter((result) => result.status === "succeeded")
    .map((result) => result.clipPath)
    .filter((clipPath): clipPath is string => Boolean(clipPath));
  const cacheHits = orderedSceneResults
    .filter((result) => result.cached)
    .map((result) => ({
      sceneId: result.sceneId,
      cacheKey: result.cacheKey,
      clipPath: result.clipPath,
      taskId: result.taskId
    }));
  const firstError = orderedSceneResults.find((result) => result.error)?.error;

  if (firstError) {
    const errorPayload = {
      scenes: summarizeScenes(input.scenes, input.returnPrompts),
      taskIds,
      clipPaths,
      sceneResults: orderedSceneResults,
      cacheHits,
      qualityProfile: input.profile,
      estimate: input.estimate,
      promptMode: input.promptMode,
      parallel: { maxConcurrency },
      subtitleTimeline,
      error: firstError
    };
    return {
      ...errorPayload,
      manifestPath: await writeMovieManifest(input.args, errorPayload)
    };
  }

  const finalVideoPath = await concatVideos({
    inputPaths: clipPaths,
    outputFileName: optionalString(input.args, "outputFileName")
  });

  const successPayload: Record<string, unknown> = {
    scenes: summarizeScenes(input.scenes, input.returnPrompts),
    taskIds,
    clipPaths,
    sceneResults: orderedSceneResults,
    finalVideoPath,
    cacheHits,
    qualityProfile: input.profile,
    estimate: input.estimate,
    promptMode: input.promptMode,
    parallel: { maxConcurrency },
    subtitleTimeline
  };

  if (subtitleMode === "burn") {
    const subtitlePath = await writeAssSubtitleFile({
      cues: subtitleTimeline,
      outputFileName: replaceExtension(optionalString(input.args, "outputFileName") ?? "movie-subtitles.ass", ".ass")
    });
    successPayload.subtitlePath = subtitlePath;
    successPayload.subtitledVideoPath = await burnSubtitles({
      inputPath: finalVideoPath,
      subtitlePath,
      outputFileName: prefixFileName(optionalString(input.args, "outputFileName") ?? "movie.mp4", "subtitled-")
    });
  }

  successPayload.manifestPath = await writeMovieManifest(input.args, successPayload);
  return successPayload;
}

interface SceneGenerationResult {
  sceneId: string;
  status: VideoTaskResult["status"] | "skipped";
  cached: boolean;
  cacheKey?: string;
  taskId?: string;
  videoUrl?: string;
  clipPath?: string;
  error?: string;
}

async function runSingleSceneGeneration(
  input: {
    args: JsonRecord;
    references: ReferenceMedia[];
    resolution: string;
    generateAudio: boolean;
    client: ArkVideoClient;
  },
  scene: ScenePrompt,
  index: number
): Promise<SceneGenerationResult> {
  const createInput: CreateTaskInput = {
    prompt: appendReferenceBinding(scene.prompt, input.references),
    duration: scene.duration,
    ratio: scene.ratio,
    resolution: input.resolution,
    generateAudio: input.generateAudio,
    watermark: optionalBoolean(input.args, "watermark"),
    model: optionalString(input.args, "model"),
    references: input.references
  };
  const cacheKey = buildVideoRequestCacheKey(createInput);

  const cachedClip = shouldUseCache(input.args) ? await getUsableCachedClip(cacheKey) : undefined;
  if (cachedClip?.clipPath) {
    return {
      sceneId: scene.id,
      status: "succeeded",
      cached: true,
      cacheKey,
      taskId: cachedClip.taskId ?? `cached:${cacheKey.slice(0, 12)}`,
      clipPath: cachedClip.clipPath
    };
  }

  let taskId = shouldUseCache(input.args) ? (await getCachedVideoEntry(cacheKey))?.taskId : undefined;
  let taskVideoUrl: string | undefined;
  if (taskId) {
    const cachedTask = await waitCachedTask(input.client, taskId, input.args);
    if (cachedTask?.status === "succeeded" && cachedTask.videoUrl) {
      taskVideoUrl = cachedTask.videoUrl;
    } else {
      taskId = undefined;
    }
  }

  if (!taskId) {
    taskId = await input.client.createTask(createInput);
    await rememberVideoTask(cacheKey, taskId);
  }

  const task: VideoTaskResult =
    taskVideoUrl === undefined
      ? await input.client.waitTask(taskId, {
          pollIntervalMs: secondsToMs(optionalNumber(input.args, "pollIntervalSeconds") ?? 30),
          timeoutMs: secondsToMs(optionalNumber(input.args, "timeoutSeconds") ?? 1800)
        })
      : { id: taskId, status: "succeeded", videoUrl: taskVideoUrl };

  if (task.status !== "succeeded" || !task.videoUrl) {
    return {
      sceneId: scene.id,
      status: task.status,
      cached: false,
      cacheKey,
      taskId,
      error: task.error ?? `Task ${taskId} ended with status ${task.status}`
    };
  }

  const clipPath = await downloadVideo({
    videoUrl: task.videoUrl,
    fileName: `scene-${String(index + 1).padStart(2, "0")}-${taskId}.mp4`
  });
  await rememberVideoClip(cacheKey, { taskId, clipPath });
  return {
    sceneId: scene.id,
    status: "succeeded",
    cached: false,
    cacheKey,
    taskId,
    videoUrl: task.videoUrl,
    clipPath
  };
}

async function waitCachedTask(client: ArkVideoClient, taskId: string, args: JsonRecord) {
  try {
    return await client.waitTask(taskId, {
      pollIntervalMs: secondsToMs(optionalNumber(args, "pollIntervalSeconds") ?? 30),
      timeoutMs: secondsToMs(optionalNumber(args, "timeoutSeconds") ?? 1800)
    });
  } catch {
    return undefined;
  }
}

type SubtitleMode = "none" | "manifest" | "burn";

function readSubtitleMode(args: JsonRecord): SubtitleMode {
  const mode = optionalString(args, "subtitleMode") ?? "manifest";
  if (mode === "none" || mode === "manifest" || mode === "burn") {
    return mode;
  }
  throw new Error("subtitleMode must be none, manifest, or burn");
}

function buildSubtitleSceneInputs(args: JsonRecord, scenes: ScenePrompt[]) {
  const subtitles = optionalStringArray(args, "subtitles");
  if (subtitles && subtitles.length !== scenes.length) {
    throw new Error("subtitles length must match scene count");
  }
  const summaries = summarizeScenes(scenes, false) as Array<{ beat: string }>;
  return scenes.map((scene, index) => ({
    id: scene.id,
    duration: scene.duration,
    text: subtitles?.[index] ?? summaries[index]?.beat ?? scene.id
  }));
}

async function writeMovieManifest(args: JsonRecord, payload: Record<string, unknown>): Promise<string> {
  await mkdir(DEFAULT_OUTPUT_DIR, { recursive: true });
  const outputFileName = sanitizeJsonFileName(
    optionalString(args, "outputManifestFileName") ?? `movie-manifest-${timestampForFileName()}.json`
  );
  const outputPath = path.resolve(DEFAULT_OUTPUT_DIR, outputFileName);
  await writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...payload }, null, 2), "utf8");
  return outputPath;
}

function sanitizeJsonFileName(fileName: string): string {
  const baseName = path.basename(fileName).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
  const safeName = baseName || `movie-manifest-${Date.now()}.json`;
  return safeName.toLowerCase().endsWith(".json") ? safeName : `${safeName}.json`;
}

function prefixFileName(fileName: string, prefix: string): string {
  const baseName = path.basename(fileName);
  return `${prefix}${baseName}`;
}

function replaceExtension(fileName: string, extension: string): string {
  const baseName = path.basename(fileName);
  return `${baseName.replace(/\.[^.]+$/, "")}${extension}`;
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readSplitStoryInput(args: JsonRecord) {
  return {
    story: requiredString(args, "story"),
    sceneCount: optionalNumber(args, "sceneCount"),
    secondsPerScene: optionalNumber(args, "secondsPerScene"),
    ratio: optionalString(args, "ratio"),
    style: optionalString(args, "style"),
    character: optionalString(args, "character"),
    narrativeStyle: optionalString(args, "narrativeStyle"),
    storySkillPath: optionalString(args, "storySkillPath")
  };
}

function readArticleInput(args: JsonRecord) {
  return {
    text: optionalString(args, "text") ?? requiredString(args, "article"),
    sceneCount: optionalNumber(args, "sceneCount"),
    secondsPerScene: optionalNumber(args, "secondsPerScene"),
    ratio: optionalString(args, "ratio"),
    style: optionalString(args, "style"),
    character: optionalString(args, "character"),
    audience: optionalString(args, "audience"),
    visualGoal: optionalString(args, "visualGoal"),
    narrativeStyle: optionalString(args, "narrativeStyle"),
    storySkillPath: optionalString(args, "storySkillPath")
  };
}

function summarizeCreateInput(input: CreateTaskInput): Record<string, unknown> {
  return {
    prompt: input.prompt,
    duration: input.duration,
    ratio: input.ratio,
    resolution: input.resolution,
    generateAudio: input.generateAudio,
    watermark: input.watermark ?? false,
    model: input.model,
    referenceCount: input.references?.length ?? 0
  };
}

function readReferences(args: JsonRecord): ReferenceMedia[] {
  const references: ReferenceMedia[] = [
    ...referenceUrlArray(args, "referenceImageUrls", "image_url"),
    ...referenceUrlArray(args, "imageUrls", "image_url"),
    ...referenceUrlArray(args, "referenceVideoUrls", "video_url"),
    ...referenceUrlArray(args, "videoUrls", "video_url"),
    ...referenceUrlArray(args, "referenceAudioUrls", "audio_url"),
    ...referenceUrlArray(args, "audioUrls", "audio_url"),
    ...referenceObjectArray(args, "references")
  ];

  return normalizeReferenceMedia(references);
}

function applyReferencesToScenes(scenes: ScenePrompt[], references: ReferenceMedia[]): ScenePrompt[] {
  if (references.length === 0) {
    return scenes;
  }

  return scenes.map((scene) => ({
    ...scene,
    prompt: appendReferenceBinding(scene.prompt, references)
  }));
}

function appendReferenceBinding(prompt: string, references: ReferenceMedia[]): string {
  const normalizedReferences = normalizeReferenceMedia(references);
  if (normalizedReferences.length === 0) {
    return prompt;
  }

  const bindings = buildReferenceBindings(normalizedReferences).join("；");
  return `${prompt}参考素材绑定：${bindings}。提示词中的图片1/视频1/音频1等编号对应本次 content 数组内同类型参考素材顺序；只把素材作为构图、首尾帧、动作节奏、音乐或质感参考，不生成网页界面或字幕说明。`;
}

function buildReferenceBindings(references: ReferenceMedia[]): string[] {
  let imageIndex = 0;
  let videoIndex = 0;
  let audioIndex = 0;

  return references.map((reference) => {
    switch (reference.type) {
      case "image_url":
        imageIndex += 1;
        return `图片${imageIndex}=${describeReferenceRole(reference.role, "参考图片")}`;
      case "video_url":
        videoIndex += 1;
        return `视频${videoIndex}=${describeReferenceRole(reference.role, "参考视频")}`;
      case "audio_url":
        audioIndex += 1;
        return `音频${audioIndex}=${describeReferenceRole(reference.role, "参考音频")}`;
    }
  });
}

function describeReferenceRole(role: string | undefined, fallback: string): string {
  if (!role) {
    return fallback;
  }
  switch (role) {
    case "reference_image":
      return "参考图片";
    case "reference_video":
      return "参考视频";
    case "reference_audio":
      return "参考音频";
    default:
      return role;
  }
}

function referenceUrlArray(args: JsonRecord, key: string, type: ReferenceMediaType): ReferenceMedia[] {
  const value = args[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be a string array`);
  }

  return value.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${key} must be a string array`);
    }
    const url = item.trim();
    assertHttpUrl(url, key);
    return { type, url };
  });
}

function referenceObjectArray(args: JsonRecord, key: string): ReferenceMedia[] {
  const value = args[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array`);
  }

  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key} entries must be objects`);
    }
    const record = item as JsonRecord;
    const type = requiredString(record, "type") as ReferenceMediaType;
    if (type !== "image_url" && type !== "video_url" && type !== "audio_url") {
      throw new Error(`${key}.type must be image_url, video_url, or audio_url`);
    }
    const url = requiredString(record, "url");
    assertHttpUrl(url, key);
    return {
      type,
      url,
      role: optionalString(record, "role")
    };
  });
}

function assertHttpUrl(url: string, fieldName: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return;
    }
  } catch {
    // Fall through to a clear error below.
  }
  throw new Error(`${fieldName} must contain HTTP(S) URLs`);
}

function asRecord(value: unknown): JsonRecord {
  if (!value) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be a JSON object");
  }
  return value as JsonRecord;
}

function requiredString(args: JsonRecord, key: string): string {
  const value = optionalString(args, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(args: JsonRecord, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(args: JsonRecord, key: string): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function optionalBoolean(args: JsonRecord, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function isDryRun(args: JsonRecord): boolean {
  return optionalBoolean(args, "dryRun") === true || optionalBoolean(args, "estimateOnly") === true;
}

function shouldUseCache(args: JsonRecord): boolean {
  return optionalBoolean(args, "forceRegenerate") !== true && optionalBoolean(args, "useCache") !== false;
}

function stringArray(args: JsonRecord, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${key} must be a non-empty string array`);
  }
  return value.map((item) => item.trim());
}

function optionalStringArray(args: JsonRecord, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${key} must be a string array`);
  }
  return value.map((item) => item.trim());
}

function secondsToMs(seconds: number): number {
  return Math.max(1, seconds) * 1000;
}
