import { describe, expect, it } from "vitest";
import { buildVideoRequestCacheKey } from "../src/cache.js";

describe("video request cache keys", () => {
  it("keeps identical video requests stable", () => {
    const first = buildVideoRequestCacheKey({
      prompt: "同一个提示词",
      duration: 5,
      ratio: "16:9",
      resolution: "1080p",
      generateAudio: true,
      watermark: false
    });
    const second = buildVideoRequestCacheKey({
      prompt: "同一个提示词",
      duration: 5,
      ratio: "16:9",
      resolution: "1080p",
      generateAudio: true,
      watermark: false
    });

    expect(first).toBe(second);
  });

  it("separates draft and final resolution requests", () => {
    const draft = buildVideoRequestCacheKey({
      prompt: "同一个提示词",
      duration: 5,
      ratio: "16:9",
      resolution: "720p"
    });
    const final = buildVideoRequestCacheKey({
      prompt: "同一个提示词",
      duration: 5,
      ratio: "16:9",
      resolution: "1080p"
    });

    expect(draft).not.toBe(final);
  });
});
