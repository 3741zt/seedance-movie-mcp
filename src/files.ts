import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_OUTPUT_DIR } from "./config.js";
import type { FetchLike } from "./ark.js";

export interface DownloadVideoInput {
  videoUrl: string;
  fileName: string;
  outputDir?: string;
  fetchFn?: FetchLike;
}

export async function downloadVideo(input: DownloadVideoInput): Promise<string> {
  if (!input.videoUrl.trim()) {
    throw new Error("videoUrl is required");
  }
  if (!input.fileName.trim()) {
    throw new Error("fileName is required");
  }

  const outputDir = input.outputDir ?? DEFAULT_OUTPUT_DIR;
  await mkdir(outputDir, { recursive: true });

  const response = await (input.fetchFn ?? fetch)(input.videoUrl, {
    method: "GET"
  });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const targetPath = path.resolve(outputDir, sanitizeMp4FileName(input.fileName));
  await writeFile(targetPath, buffer);
  return targetPath;
}

export function sanitizeMp4FileName(fileName: string): string {
  const baseName = path.basename(fileName).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
  const safeName = baseName || `video-${Date.now()}.mp4`;
  return safeName.toLowerCase().endsWith(".mp4") ? safeName : `${safeName}.mp4`;
}
