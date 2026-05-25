import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool } from "../src/tools.js";
import { getRuntimeConfig } from "../src/config.js";

describe("runtime config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads Codex MCP env without exposing the API key", async () => {
    vi.stubEnv("ARK_API_KEY", "secret-key");
    vi.stubEnv("ARK_MODEL", "doubao-seedance-test-model");
    vi.stubEnv("ARK_BASE_URL", "https://ark.example.com/api/v3/");
    vi.stubEnv("ARK_MAX_CONCURRENCY", "4");
    vi.stubEnv("FFMPEG_PATH", "C:\\ffmpeg\\bin\\ffmpeg.exe");

    expect(getRuntimeConfig()).toMatchObject({
      apiKey: "secret-key",
      hasApiKey: true,
      model: "doubao-seedance-test-model",
      baseUrl: "https://ark.example.com/api/v3",
      maxConcurrency: 4,
      ffmpegPath: "C:\\ffmpeg\\bin\\ffmpeg.exe"
    });

    const result = await callTool("check_runtime_config", {});

    expect(result).toEqual({
      hasApiKey: true,
      model: "doubao-seedance-test-model",
      baseUrl: "https://ark.example.com/api/v3",
      ffmpegPath: "C:\\ffmpeg\\bin\\ffmpeg.exe",
      maxConcurrency: 4
    });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("clamps invalid concurrency to the safe default", () => {
    vi.stubEnv("ARK_MAX_CONCURRENCY", "99");

    expect(getRuntimeConfig().maxConcurrency).toBe(3);
  });
});
