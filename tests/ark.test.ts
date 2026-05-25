import { describe, expect, it, vi } from "vitest";
import { ArkVideoClient } from "../src/ark.js";

describe("ArkVideoClient", () => {
  it("constructs Seedance create task URL, headers, and body correctly", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "cgt-test-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new ArkVideoClient({
      apiKey: "test-token",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      fetchFn: fetchMock
    });

    const taskId = await client.createTask({
      prompt: "电影感雨夜街头，一个穿黑色风衣的男人缓慢抬头。",
      duration: 5,
      ratio: "16:9"
    });

    expect(taskId).toBe("cgt-test-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token"
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "doubao-seedance-2-0-260128",
      content: [
        {
          type: "text",
          text: "电影感雨夜街头，一个穿黑色风衣的男人缓慢抬头。"
        }
      ],
      generate_audio: true,
      ratio: "16:9",
      duration: 5,
      resolution: "1080p",
      watermark: false
    });
  });

  it("constructs multimodal reference content for the official video task API", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "cgt-multimodal" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new ArkVideoClient({
      apiKey: "test-token",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      fetchFn: fetchMock
    });

    await client.createTask({
      prompt: "全程使用图片1作为首帧，视频1作为第一视角构图，音频1作为背景音乐。",
      duration: 11,
      ratio: "16:9",
      references: [
        { type: "image_url", url: "https://example.com/start.jpg" },
        { type: "video_url", url: "https://example.com/ref.mp4" },
        { type: "audio_url", url: "https://example.com/music.mp3" }
      ]
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      content: [
        {
          type: "text",
          text: "全程使用图片1作为首帧，视频1作为第一视角构图，音频1作为背景音乐。"
        },
        {
          type: "image_url",
          image_url: { url: "https://example.com/start.jpg" },
          role: "reference_image"
        },
        {
          type: "video_url",
          video_url: { url: "https://example.com/ref.mp4" },
          role: "reference_video"
        },
        {
          type: "audio_url",
          audio_url: { url: "https://example.com/music.mp3" },
          role: "reference_audio"
        }
      ],
      duration: 11
    });
  });

  it("extracts content.video_url from get task responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "cgt-test-123",
          model: "doubao-seedance-2-0-260128",
          status: "succeeded",
          content: {
            video_url: "https://example.com/video.mp4"
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    const client = new ArkVideoClient({
      apiKey: "test-token",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      fetchFn: fetchMock
    });

    const result = await client.getTask("cgt-test-123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-test-123",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer test-token"
        }
      }
    );
    expect(result).toEqual({
      id: "cgt-test-123",
      model: "doubao-seedance-2-0-260128",
      status: "succeeded",
      videoUrl: "https://example.com/video.mp4",
      error: undefined
    });
  });

  it("retries transient create task failures before succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "gateway unavailable" }), { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "cgt-after-retry" }), { status: 200 }));
    const client = new ArkVideoClient({
      apiKey: "test-token",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      fetchFn: fetchMock,
      retryDelayMs: 0
    });

    await expect(client.createTask({ prompt: "重试后成功" })).resolves.toBe("cgt-after-retry");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-transient client errors", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "bad request" }), { status: 400 }));
    const client = new ArkVideoClient({
      apiKey: "test-token",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      fetchFn: fetchMock,
      retryDelayMs: 0
    });

    await expect(client.createTask({ prompt: "参数错误" })).rejects.toThrow("HTTP 400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
