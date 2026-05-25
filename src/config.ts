import * as ffmpegStaticModule from "ffmpeg-static";
import os from "node:os";
import path from "node:path";

export const DEFAULT_MODEL = "doubao-seedance-2-0-260128";
export const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
export const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), "Desktop", "mcp", "outputs");
export const DEFAULT_FFMPEG_PATH = "ffmpeg";
export const DEFAULT_MAX_CONCURRENCY = 3;
export const MIN_MAX_CONCURRENCY = 1;
export const MAX_MAX_CONCURRENCY = 5;

export interface RuntimeConfig {
  apiKey?: string;
  hasApiKey: boolean;
  model: string;
  baseUrl: string;
  ffmpegPath: string;
  maxConcurrency: number;
}

export function readEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function getArkApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return readEnvValue(env, "ARK_API_KEY");
}

export function getArkModel(env: NodeJS.ProcessEnv = process.env): string {
  return readEnvValue(env, "ARK_MODEL") ?? DEFAULT_MODEL;
}

export function getArkBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return trimTrailingSlash(readEnvValue(env, "ARK_BASE_URL") ?? DEFAULT_BASE_URL);
}

export function getArkMaxConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = readEnvValue(env, "ARK_MAX_CONCURRENCY");
  if (!raw) {
    return DEFAULT_MAX_CONCURRENCY;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_MAX_CONCURRENCY || parsed > MAX_MAX_CONCURRENCY) {
    return DEFAULT_MAX_CONCURRENCY;
  }

  return parsed;
}

export function normalizeMaxConcurrency(value: number | undefined, fallback = getArkMaxConcurrency()): number {
  if (value === undefined || !Number.isInteger(value) || value < MIN_MAX_CONCURRENCY || value > MAX_MAX_CONCURRENCY) {
    return fallback;
  }
  return value;
}

export function getFfmpegPath(env: NodeJS.ProcessEnv = process.env): string {
  return readEnvValue(env, "FFMPEG_PATH") ?? resolveFfmpegStaticPath() ?? DEFAULT_FFMPEG_PATH;
}

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const apiKey = getArkApiKey(env);
  return {
    apiKey,
    hasApiKey: Boolean(apiKey),
    model: getArkModel(env),
    baseUrl: getArkBaseUrl(env),
    ffmpegPath: getFfmpegPath(env),
    maxConcurrency: getArkMaxConcurrency(env)
  };
}

function resolveFfmpegStaticPath(): string | undefined {
  const value = (ffmpegStaticModule as { default?: unknown }).default ?? ffmpegStaticModule;
  return typeof value === "string" && value ? value : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
