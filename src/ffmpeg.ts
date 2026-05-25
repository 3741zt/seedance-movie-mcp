import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_OUTPUT_DIR, getFfmpegPath } from "./config.js";
import { sanitizeMp4FileName } from "./files.js";

export interface ConcatVideosInput {
  inputPaths: string[];
  outputFileName?: string;
  outputDir?: string;
  ffmpegPath?: string;
}

export interface SubtitleSceneInput {
  id: string;
  duration: number;
  text: string;
}

export interface SubtitleCue {
  sceneId: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface BurnSubtitlesInput {
  inputPath: string;
  subtitlePath: string;
  outputFileName?: string;
  outputDir?: string;
  ffmpegPath?: string;
}

export function buildConcatListContent(inputPaths: string[]): string {
  if (inputPaths.length === 0) {
    throw new Error("inputPaths must include at least one mp4 path");
  }

  return inputPaths.map((filePath) => `file '${escapeConcatFilePath(filePath)}'`).join("\n") + "\n";
}

export function escapeConcatFilePath(filePath: string): string {
  return normalizeFfmpegPath(filePath).replace(/'/g, "'\\''");
}

export function buildSubtitleTimeline(scenes: SubtitleSceneInput[]): SubtitleCue[] {
  let current = 0;
  return scenes.map((scene) => {
    const startSeconds = current;
    const endSeconds = current + Math.max(0, scene.duration);
    current = endSeconds;
    return {
      sceneId: scene.id,
      startSeconds,
      endSeconds,
      text: scene.text
    };
  });
}

export function buildAssSubtitleContent(cues: SubtitleCue[]): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Microsoft YaHei,48,&H00FFFFFF,&H00FFFFFF,&H7F000000,&H7F000000,0,0,0,0,100,100,0,0,1,2,1,2,80,80,80,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map(
      (cue) =>
        `Dialogue: 0,${formatAssTime(cue.startSeconds)},${formatAssTime(cue.endSeconds)},Default,,0,0,0,,${escapeAssText(
          cue.text
        )}`
    ),
    ""
  ].join("\n");
}

export async function writeAssSubtitleFile(input: {
  cues: SubtitleCue[];
  outputFileName?: string;
  outputDir?: string;
}): Promise<string> {
  const outputDir = input.outputDir ?? DEFAULT_OUTPUT_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.resolve(outputDir, sanitizeAssFileName(input.outputFileName ?? `subtitles-${timestampForFileName()}.ass`));
  await writeFile(outputPath, buildAssSubtitleContent(input.cues), "utf8");
  return outputPath;
}

export async function burnSubtitles(input: BurnSubtitlesInput): Promise<string> {
  if (!input.inputPath.trim()) {
    throw new Error("inputPath is required");
  }
  if (!input.subtitlePath.trim()) {
    throw new Error("subtitlePath is required");
  }

  const outputDir = input.outputDir ?? DEFAULT_OUTPUT_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.resolve(
    outputDir,
    sanitizeMp4FileName(input.outputFileName ?? `movie-subtitled-${timestampForFileName()}.mp4`)
  );

  await runFfmpeg(input.ffmpegPath ?? getFfmpegPath(), [
    "-y",
    "-i",
    path.resolve(input.inputPath),
    "-vf",
    `ass=${escapeFilterPath(input.subtitlePath)}`,
    "-c:a",
    "copy",
    outputPath
  ]);

  return outputPath;
}

export async function concatVideos(input: ConcatVideosInput): Promise<string> {
  if (input.inputPaths.length === 0) {
    throw new Error("inputPaths must include at least one mp4 path");
  }

  const outputDir = input.outputDir ?? DEFAULT_OUTPUT_DIR;
  await mkdir(outputDir, { recursive: true });

  const outputFileName = sanitizeMp4FileName(input.outputFileName ?? `movie-${timestampForFileName()}.mp4`);
  const outputPath = path.resolve(outputDir, outputFileName);
  const listPath = path.resolve(outputDir, `concat-${timestampForFileName()}.txt`);
  await writeFile(listPath, buildConcatListContent(input.inputPaths), "utf8");

  await runFfmpeg(input.ffmpegPath ?? getFfmpegPath(), [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath
  ]);

  return outputPath;
}

function formatAssTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const centiseconds = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(
    centiseconds
  ).padStart(2, "0")}`;
}

function escapeAssText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");
}

function escapeFilterPath(filePath: string): string {
  return normalizeFfmpegPath(filePath).replace(/:/g, "\\:");
}

function normalizeFfmpegPath(filePath: string): string {
  if (isWindowsAbsolutePath(filePath) || isWindowsUncPath(filePath)) {
    return filePath.replace(/\\/g, "/");
  }
  return path.resolve(filePath).replace(/\\/g, "/");
}

function isWindowsAbsolutePath(filePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(filePath);
}

function isWindowsUncPath(filePath: string): boolean {
  return /^\\\\[^\\]+\\[^\\]+/.test(filePath) || /^\/\/[^/]+\/[^/]+/.test(filePath);
}

function sanitizeAssFileName(fileName: string): string {
  const baseName = path.basename(fileName).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
  const safeName = baseName || `subtitles-${Date.now()}.ass`;
  return safeName.toLowerCase().endsWith(".ass") ? safeName : `${safeName}.ass`;
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true
    });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
