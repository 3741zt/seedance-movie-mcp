import { describe, expect, it } from "vitest";
import { buildAssSubtitleContent, buildConcatListContent, buildSubtitleTimeline } from "../src/ffmpeg.js";

describe("buildConcatListContent", () => {
  it("escapes Windows paths for ffmpeg concat demuxer list files", () => {
    const content = buildConcatListContent([
      "C:\\Videos\\mcp\\outputs\\clip 01.mp4",
      "C:\\Videos\\mcp\\outputs\\Bob's clip.mp4"
    ]);

    expect(content).toBe(
      "file 'C:/Videos/mcp/outputs/clip 01.mp4'\n" +
        "file 'C:/Videos/mcp/outputs/Bob'\\''s clip.mp4'\n"
    );
  });
});

describe("subtitle helpers", () => {
  it("builds cumulative subtitle timing from scene durations", () => {
    const timeline = buildSubtitleTimeline([
      { id: "scene-01", duration: 4, text: "第一句" },
      { id: "scene-02", duration: 6, text: "第二句" }
    ]);

    expect(timeline).toEqual([
      { sceneId: "scene-01", startSeconds: 0, endSeconds: 4, text: "第一句" },
      { sceneId: "scene-02", startSeconds: 4, endSeconds: 10, text: "第二句" }
    ]);
  });

  it("escapes ASS subtitle text", () => {
    const content = buildAssSubtitleContent([
      { sceneId: "scene-01", startSeconds: 0, endSeconds: 4, text: "第一{句}\\换行\n下一行" }
    ]);

    expect(content).toContain("[Script Info]");
    expect(content).toContain("Dialogue: 0,0:00:00.00,0:00:04.00,Default,,0,0,0,,第一\\{句\\}\\\\换行\\N下一行");
  });
});
