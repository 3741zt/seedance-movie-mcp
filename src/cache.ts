import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeReferenceMedia, type CreateTaskInput } from "./ark.js";
import { DEFAULT_OUTPUT_DIR, DEFAULT_MODEL } from "./config.js";

export interface VideoCacheEntry {
  cacheKey: string;
  taskId?: string;
  clipPath?: string;
  createdAt: string;
  updatedAt: string;
}

interface VideoCacheFile {
  version: 1;
  entries: Record<string, VideoCacheEntry>;
}

const CACHE_FILE_NAME = ".seedance-cache.json";

export function buildVideoRequestCacheKey(input: CreateTaskInput): string {
  const canonical = stableJson({
    model: input.model ?? DEFAULT_MODEL,
    prompt: input.prompt.trim(),
    duration: input.duration ?? 5,
    ratio: input.ratio ?? "16:9",
    resolution: input.resolution ?? "1080p",
    generateAudio: input.generateAudio ?? true,
    watermark: input.watermark ?? false,
    references: normalizeReferenceMedia(input.references ?? [])
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function readVideoCache(cacheDir = DEFAULT_OUTPUT_DIR): Promise<VideoCacheFile> {
  const cachePath = getVideoCachePath(cacheDir);
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isVideoCacheFile(parsed)) {
      return parsed;
    }
  } catch {
    // Missing or corrupt cache files should never block generation.
  }
  return { version: 1, entries: {} };
}

export async function getCachedVideoEntry(cacheKey: string, cacheDir = DEFAULT_OUTPUT_DIR): Promise<VideoCacheEntry | undefined> {
  const cache = await readVideoCache(cacheDir);
  return cache.entries[cacheKey];
}

export async function getUsableCachedClip(cacheKey: string, cacheDir = DEFAULT_OUTPUT_DIR): Promise<VideoCacheEntry | undefined> {
  const entry = await getCachedVideoEntry(cacheKey, cacheDir);
  if (!entry?.clipPath) {
    return undefined;
  }
  try {
    const file = await stat(entry.clipPath);
    return file.isFile() && file.size > 0 ? entry : undefined;
  } catch {
    return undefined;
  }
}

export async function rememberVideoTask(cacheKey: string, taskId: string, cacheDir = DEFAULT_OUTPUT_DIR): Promise<void> {
  await updateVideoCacheEntry(cacheKey, { taskId }, cacheDir);
}

export async function rememberVideoClip(
  cacheKey: string,
  input: {
    taskId?: string;
    clipPath: string;
  },
  cacheDir = DEFAULT_OUTPUT_DIR
): Promise<void> {
  await updateVideoCacheEntry(cacheKey, input, cacheDir);
}

function getVideoCachePath(cacheDir: string): string {
  return path.resolve(cacheDir, CACHE_FILE_NAME);
}

async function updateVideoCacheEntry(
  cacheKey: string,
  patch: Partial<Pick<VideoCacheEntry, "taskId" | "clipPath">>,
  cacheDir: string
): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const cache = await readVideoCache(cacheDir);
  const now = new Date().toISOString();
  const existing = cache.entries[cacheKey];
  cache.entries[cacheKey] = {
    cacheKey,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    taskId: patch.taskId ?? existing?.taskId,
    clipPath: patch.clipPath ?? existing?.clipPath
  };
  await writeFile(getVideoCachePath(cacheDir), JSON.stringify(cache, null, 2), "utf8");
}

function isVideoCacheFile(value: unknown): value is VideoCacheFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.version === 1 && Boolean(record.entries) && typeof record.entries === "object" && !Array.isArray(record.entries);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
