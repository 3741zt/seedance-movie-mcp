import { DEFAULT_BASE_URL, DEFAULT_MODEL, getArkApiKey, getArkBaseUrl, getArkModel } from "./config.js";

export type VideoTaskStatus = "queued" | "running" | "succeeded" | "failed" | "expired" | "cancelled" | string;

export interface ArkVideoClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: FetchLike;
  retryDelayMs?: number;
  maxRetries?: number;
}

export interface CreateTaskInput {
  prompt: string;
  duration?: number;
  ratio?: string;
  generateAudio?: boolean;
  resolution?: string;
  watermark?: boolean;
  model?: string;
  references?: ReferenceMedia[];
}

export type ReferenceMediaType = "image_url" | "video_url" | "audio_url";

export interface ReferenceMedia {
  type: ReferenceMediaType;
  url: string;
  role?: string;
}

export interface VideoTaskResult {
  id: string;
  model?: string;
  status: VideoTaskStatus;
  videoUrl?: string;
  error?: string;
}

export interface WaitTaskOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface ArkClientFromEnvResult {
  client?: ArkVideoClient;
  error?: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TASKS_PATH = "/contents/generations/tasks";
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRIES = 3;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "expired", "cancelled"]);

export class ArkVideoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchFn: FetchLike;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;

  constructor(options: ArkVideoClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL);
    this.model = options.model ?? DEFAULT_MODEL;
    this.fetchFn = options.fetchFn ?? fetch;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async createTask(input: CreateTaskInput): Promise<string> {
    if (!this.apiKey) {
      throw new Error("ARK_API_KEY is not set. Set ARK_API_KEY before creating video tasks.");
    }
    if (!input.prompt?.trim()) {
      throw new Error("prompt is required");
    }

    const body = {
      model: input.model ?? this.model,
      content: [
        {
          type: "text",
          text: input.prompt
        },
        ...normalizeReferenceMedia(input.references ?? []).map(toArkContentItem)
      ],
      generate_audio: input.generateAudio ?? true,
      ratio: input.ratio ?? "16:9",
      duration: input.duration ?? 5,
      resolution: input.resolution ?? "1080p",
      watermark: input.watermark ?? false
    };

    const response = await this.fetchWithRetries(`${this.baseUrl}${TASKS_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    const data = await parseArkResponse(response, "create video task");
    const id = getStringField(data, "id");
    if (!id) {
      throw new Error("Ark create task response did not include id");
    }
    return id;
  }

  async getTask(taskId: string): Promise<VideoTaskResult> {
    if (!this.apiKey) {
      throw new Error("ARK_API_KEY is not set. Set ARK_API_KEY before querying video tasks.");
    }
    if (!taskId.trim()) {
      throw new Error("taskId is required");
    }

    const response = await this.fetchWithRetries(`${this.baseUrl}${TASKS_PATH}/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    });

    const data = await parseArkResponse(response, "get video task");
    const status = getStringField(data, "status") ?? "unknown";
    return {
      id: getStringField(data, "id") ?? taskId,
      model: getStringField(data, "model"),
      status,
      videoUrl: getNestedStringField(data, ["content", "video_url"]),
      error: extractArkError(data)
    };
  }

  async waitTask(taskId: string, options: WaitTaskOptions = {}): Promise<VideoTaskResult> {
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const task = await this.getTask(taskId);
      if (TERMINAL_STATUSES.has(task.status)) {
        return task;
      }
      if (Date.now() >= deadline) {
        return {
          ...task,
          error: `Timed out waiting for task ${taskId} after ${Math.round(timeoutMs / 1000)} seconds`
        };
      }
      await sleep(Math.max(1_000, pollIntervalMs));
    }
  }

  private async fetchWithRetries(url: string, init: RequestInit): Promise<Response> {
    let response: Response | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      response = await this.fetchFn(url, init);
      if (!isRetryableStatus(response.status) || attempt === this.maxRetries) {
        return response;
      }
      await sleep(this.retryDelayMs * 2 ** attempt);
    }

    return response!;
  }
}

export function normalizeReferenceMedia(references: ReferenceMedia[]): ReferenceMedia[] {
  return references
    .map((reference) => ({
      type: reference.type,
      url: reference.url.trim(),
      role: reference.role?.trim() || defaultReferenceRole(reference.type)
    }))
    .filter((reference) => isReferenceType(reference.type) && reference.url.length > 0);
}

export function createArkClientFromEnv(env: NodeJS.ProcessEnv = process.env, fetchFn?: FetchLike): ArkClientFromEnvResult {
  const apiKey = getArkApiKey(env);
  if (!apiKey) {
    return {
      error: "ARK_API_KEY is not set. Set ARK_API_KEY before calling Seedance video generation APIs."
    };
  }

  return {
    client: new ArkVideoClient({
      apiKey,
      baseUrl: getArkBaseUrl(env),
      model: getArkModel(env),
      fetchFn
    })
  };
}

async function parseArkResponse(response: Response, action: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  const data = text ? parseJsonObject(text, action) : {};
  if (!response.ok) {
    throw new Error(`Ark ${action} failed: HTTP ${response.status} ${summarizeErrorPayload(data, text)}`);
  }
  return data;
}

function parseJsonObject(text: string, action: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("JSON root is not an object");
  } catch (error) {
    throw new Error(`Ark ${action} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function extractArkError(data: Record<string, unknown>): string | undefined {
  const direct = getStringField(data, "error") ?? getStringField(data, "message");
  if (direct) {
    return direct;
  }

  const errorObject = data.error;
  if (errorObject && typeof errorObject === "object" && !Array.isArray(errorObject)) {
    return getStringField(errorObject as Record<string, unknown>, "message");
  }

  return undefined;
}

function summarizeErrorPayload(data: Record<string, unknown>, raw: string): string {
  return extractArkError(data) ?? raw.slice(0, 300);
}

function getNestedStringField(data: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = data;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current : undefined;
}

function getStringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function toArkContentItem(reference: ReferenceMedia): Record<string, unknown> {
  const urlPayload = { url: reference.url };
  switch (reference.type) {
    case "image_url":
      return {
        type: "image_url",
        image_url: urlPayload,
        role: reference.role ?? "reference_image"
      };
    case "video_url":
      return {
        type: "video_url",
        video_url: urlPayload,
        role: reference.role ?? "reference_video"
      };
    case "audio_url":
      return {
        type: "audio_url",
        audio_url: urlPayload,
        role: reference.role ?? "reference_audio"
      };
  }
}

function defaultReferenceRole(type: ReferenceMediaType): string {
  switch (type) {
    case "image_url":
      return "reference_image";
    case "video_url":
      return "reference_video";
    case "audio_url":
      return "reference_audio";
  }
}

function isReferenceType(value: string): value is ReferenceMediaType {
  return value === "image_url" || value === "video_url" || value === "audio_url";
}
