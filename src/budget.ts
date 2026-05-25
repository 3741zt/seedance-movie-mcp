import type { ReferenceMedia } from "./ark.js";
import type { ScenePrompt, SplitArticleInput, SplitStoryInput } from "./story.js";

export type QualityProfile = "cheap_preview" | "draft_movie" | "final_1080p";

export interface QualityProfileSettings {
  profile: QualityProfile;
  label: string;
  resolution: "720p" | "1080p";
  defaultSceneCount?: number;
  secondsPerScene: number;
  maxSecondsPerScene: number;
  maxSceneCount: number;
  generateAudio: boolean;
  note: string;
}

export interface VideoUsageEstimate {
  resolution: string;
  totalSeconds: number;
  estimatedTokens: number;
  tokenRateCnyPerMillion: number;
  estimatedCostCny: number;
  pricingBasis: string;
  assumptions: string[];
}

const TOKENS_PER_SECOND_1080P = 308_880 / 15;
const PURE_GENERATION_RATE_CNY_PER_MILLION = 46;
const WITH_VIDEO_INPUT_RATE_CNY_PER_MILLION = 28;

const PROFILE_SETTINGS: Record<QualityProfile, QualityProfileSettings> = {
  cheap_preview: {
    profile: "cheap_preview",
    label: "省钱预览",
    resolution: "720p",
    defaultSceneCount: 3,
    secondsPerScene: 4,
    maxSecondsPerScene: 4,
    maxSceneCount: 3,
    generateAudio: false,
    note: "只生成少量短镜头看风格，适合第一次试方向。"
  },
  draft_movie: {
    profile: "draft_movie",
    label: "完整草稿",
    resolution: "720p",
    secondsPerScene: 5,
    maxSecondsPerScene: 8,
    maxSceneCount: 8,
    generateAudio: true,
    note: "完整跑一版低成本草稿，确认分镜后再重跑 1080p。"
  },
  final_1080p: {
    profile: "final_1080p",
    label: "正式成片",
    resolution: "1080p",
    secondsPerScene: 5,
    maxSecondsPerScene: 15,
    maxSceneCount: 8,
    generateAudio: true,
    note: "正式质量输出，成本最高。"
  }
};

export function normalizeQualityProfile(value: string | undefined): QualityProfile {
  if (value === "cheap_preview" || value === "draft_movie" || value === "final_1080p") {
    return value;
  }
  return "final_1080p";
}

export function getQualityProfileSettings(value: string | undefined): QualityProfileSettings {
  return PROFILE_SETTINGS[normalizeQualityProfile(value)];
}

export function applyProfileToSplitStoryInput(input: SplitStoryInput, profile: QualityProfileSettings): SplitStoryInput {
  return {
    ...input,
    sceneCount: input.sceneCount === undefined ? profile.defaultSceneCount : Math.min(input.sceneCount, profile.maxSceneCount),
    secondsPerScene: Math.min(input.secondsPerScene ?? profile.secondsPerScene, profile.maxSecondsPerScene)
  };
}

export function applyProfileToArticleInput(input: SplitArticleInput, profile: QualityProfileSettings): SplitArticleInput {
  return {
    ...input,
    sceneCount: input.sceneCount === undefined ? profile.defaultSceneCount : Math.min(input.sceneCount, profile.maxSceneCount),
    secondsPerScene: Math.min(input.secondsPerScene ?? profile.secondsPerScene, profile.maxSecondsPerScene)
  };
}

export function estimateVideoUsage(
  scenes: Array<Pick<ScenePrompt, "duration">>,
  options: {
    resolution?: string;
    references?: ReferenceMedia[];
  } = {}
): VideoUsageEstimate {
  const resolution = options.resolution ?? "1080p";
  const totalSeconds = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const tokenRateCnyPerMillion = options.references?.some((reference) => reference.type === "video_url")
    ? WITH_VIDEO_INPUT_RATE_CNY_PER_MILLION
    : PURE_GENERATION_RATE_CNY_PER_MILLION;
  const estimatedTokens = Math.round(totalSeconds * TOKENS_PER_SECOND_1080P * resolutionMultiplier(resolution));
  const estimatedCostCny = roundMoney((estimatedTokens / 1_000_000) * tokenRateCnyPerMillion);

  return {
    resolution,
    totalSeconds,
    estimatedTokens,
    tokenRateCnyPerMillion,
    estimatedCostCny,
    pricingBasis: options.references?.some((reference) => reference.type === "video_url")
      ? "含视频输入参考，按公开视频输入场景估算"
      : "不含视频输入，按公开纯视频生成场景估算",
    assumptions: [
      "这是调用前粗估，真实消耗以火山方舟控制台用量为准。",
      "按公开视频资料中的 15 秒约 308880 tokens 作为 1080p 基准线性估算。",
      "720p 按 1080p 的 0.6 倍粗估；不同模型版本、参考素材和排队策略可能有偏差。"
    ]
  };
}

export function isEstimatedCostOverLimit(estimate: VideoUsageEstimate, maxEstimatedCostCny: number | undefined): boolean {
  return typeof maxEstimatedCostCny === "number" && estimate.estimatedCostCny > maxEstimatedCostCny;
}

function resolutionMultiplier(resolution: string): number {
  switch (resolution.toLowerCase()) {
    case "480p":
      return 0.35;
    case "720p":
      return 0.6;
    case "1080p":
      return 1;
    default:
      return 1;
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
