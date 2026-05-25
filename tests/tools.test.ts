import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool } from "../src/tools.js";

describe("tool token-saving article flow", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("infer_text_to_scenes returns compact scene summaries by default", async () => {
    const result = await callTool("infer_text_to_scenes", {
      text:
        "即梦视频能力开放给企业后，创作者可以把一段产品介绍转成电影化短片。团队用 API 批量生成分镜视频，快速下载并拼接成完整成片。",
      sceneCount: 2,
      secondsPerScene: 5
    });

    expect(result).toMatchObject({
      promptMode: "local-inference"
    });
    const scenes = (result as { scenes: Array<Record<string, unknown>> }).scenes;
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toHaveProperty("beat");
    expect(scenes[0]).not.toHaveProperty("prompt");
  });

  it("infer_text_to_scenes can return prompts when explicitly requested", async () => {
    const result = await callTool("infer_text_to_scenes", {
      text: "Seedance 2.0 API 支持企业把脚本转成视频，提升内容生产效率。",
      sceneCount: 1,
      returnPrompts: true
    });

    const scenes = (result as { scenes: Array<Record<string, unknown>> }).scenes;
    expect(scenes[0]?.prompt).toContain("原文信息提炼：");
  });

  it("plan_reference_images returns Codex-side prompts without image API calls", async () => {
    const result = await callTool("plan_reference_images", {
      text: "苹果果茶广告，首帧是带晨露的阿克苏红苹果，尾帧是透明杯分层果茶。",
      imageCount: 2,
      ratio: "16:9"
    });

    expect(result).toMatchObject({
      promptMode: "codex-image-generation"
    });
    const imagePrompts = (result as { imagePrompts: Array<Record<string, unknown>> }).imagePrompts;
    expect(imagePrompts).toHaveLength(2);
    expect(imagePrompts[0]).toHaveProperty("prompt");
    expect(result).not.toHaveProperty("imagePaths");
    expect(JSON.stringify(result)).toContain("MCP does not call any image API");
  });

  it("estimate_movie_cost plans without Ark API calls", async () => {
    const result = await callTool("estimate_movie_cost", {
      text: "两只小猫在办公室打工，系统崩溃后老板猫出现，最后小白背锅。",
      sceneCount: 8,
      secondsPerScene: 10,
      qualityProfile: "cheap_preview"
    });

    expect(result).toMatchObject({
      plannedOnly: true,
      qualityProfile: {
        profile: "cheap_preview",
        resolution: "720p"
      },
      estimate: {
        resolution: "720p"
      }
    });
    const scenes = (result as { scenes: Array<Record<string, unknown>> }).scenes;
    expect(scenes).toHaveLength(3);
    expect(scenes.every((scene) => scene.duration === 4)).toBe(true);
  });

  it("generate_movie_from_text dryRun returns budget plan without requiring ARK_API_KEY", async () => {
    const result = await callTool("generate_movie_from_text", {
      text: "两只小猫在办公室打工，系统崩溃后老板猫出现，最后小白背锅。",
      qualityProfile: "cheap_preview",
      dryRun: true
    });

    expect(result).toMatchObject({
      plannedOnly: true,
      promptMode: "local-inference",
      taskIds: [],
      clipPaths: [],
      qualityProfile: {
        profile: "cheap_preview"
      }
    });
    expect(result).toHaveProperty("estimate");
  });

  it("generate_movie_from_text requires prompt approval before Ark API calls", async () => {
    vi.stubEnv("ARK_API_KEY", "test-token");
    const fetchMock = vi.fn(async () => {
      throw new Error("Ark should not be called before prompts are approved");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = (await callTool("generate_movie_from_text", {
      text: "一个办公室咖啡机主持晨会的30秒搞笑短片。",
      sceneCount: 2,
      qualityProfile: "cheap_preview"
    })) as {
      approvalRequired: boolean;
      plannedOnly: boolean;
      promptApprovalId: string;
      scenes: Array<Record<string, unknown>>;
      taskIds: string[];
      clipPaths: string[];
    };

    expect(result.approvalRequired).toBe(true);
    expect(result.plannedOnly).toBe(true);
    expect(result.promptApprovalId).toMatch(/^prompt-plan-[a-f0-9]{16}$/);
    expect(result.taskIds).toEqual([]);
    expect(result.clipPaths).toEqual([]);
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]?.prompt).toContain("分镜1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("generate_movie_from_scenes plans polished prompts for approval without Ark API calls", async () => {
    vi.stubEnv("ARK_API_KEY", "test-token");
    const fetchMock = vi.fn(async () => {
      throw new Error("Ark should not be called before polished prompts are approved");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = (await callTool("generate_movie_from_scenes", {
      scenes: [
        {
          id: "scene-01",
          duration: 5,
          ratio: "9:16",
          prompt: "用户打磨后的分镜1：AI咖啡机一本正经开晨会，主角表情崩住。"
        },
        {
          id: "scene-02",
          duration: 5,
          ratio: "9:16",
          prompt: "用户打磨后的分镜2：打印机鼓掌，办公用品开始尬舞。"
        }
      ],
      qualityProfile: "draft_movie"
    })) as {
      approvalRequired: boolean;
      promptMode: string;
      promptApprovalId: string;
      scenes: Array<Record<string, unknown>>;
    };

    expect(result.approvalRequired).toBe(true);
    expect(result.promptMode).toBe("approved-scenes");
    expect(result.promptApprovalId).toMatch(/^prompt-plan-[a-f0-9]{16}$/);
    expect(result.scenes[0]?.prompt).toBe("用户打磨后的分镜1：AI咖啡机一本正经开晨会，主角表情崩住。");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("generate_movie_from_text rejects burn subtitle mode before Ark API calls", async () => {
    vi.stubEnv("ARK_API_KEY", "test-token");
    const fetchMock = vi.fn(async () => {
      throw new Error("Ark should not be called for invalid subtitle mode");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = (await callTool("generate_movie_from_text", {
      text: "一个办公室咖啡机主持晨会的30秒搞笑短片。",
      sceneCount: 2,
      qualityProfile: "cheap_preview",
      subtitleMode: "burn"
    })) as { error: string; taskIds: string[]; clipPaths: string[] };

    expect(result.error).toContain("subtitleMode=burn is not supported");
    expect(result.taskIds).toEqual([]);
    expect(result.clipPaths).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("generate_movie_from_text blocks over maxEstimatedCostCny before Ark API calls", async () => {
    const result = await callTool("generate_movie_from_text", {
      text: "两只小猫在办公室打工，系统崩溃后老板猫出现，最后小白背锅。",
      qualityProfile: "final_1080p",
      maxEstimatedCostCny: 0.01
    });

    expect(result).toMatchObject({
      taskIds: [],
      clipPaths: []
    });
    expect((result as { error: string }).error).toContain("No video API request was sent");
  });

  it("generate_movie_from_text stops scheduling later scenes after a failed parallel batch", async () => {
    vi.stubEnv("ARK_API_KEY", "test-token");
    let createCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      if (init?.method === "POST") {
        createCount += 1;
        return new Response(JSON.stringify({ id: `cgt-${createCount}` }), { status: 200 });
      }
      if (requestUrl.includes("/contents/generations/tasks/")) {
        return new Response(
          JSON.stringify({
            id: requestUrl.split("/").at(-1),
            status: "failed",
            error: { message: "generation failed" }
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    type MovieErrorResult = {
      error: string;
      taskIds: string[];
      clipPaths: string[];
      parallel: { maxConcurrency: number };
      sceneResults: Array<{ status: string }>;
      manifestPath: string;
    };

    const approvalPlan = (await callTool("generate_movie_from_text", {
      text: "第一段。第二段。第三段。第四段。第五段。第六段。",
      sceneCount: 3,
      maxConcurrency: 2,
      subtitleMode: "manifest",
      forceRegenerate: true
    })) as { promptApprovalId: string };

    const approvedResult = (await callTool("generate_movie_from_text", {
      text: "第一段。第二段。第三段。第四段。第五段。第六段。",
      sceneCount: 3,
      maxConcurrency: 2,
      subtitleMode: "manifest",
      forceRegenerate: true,
      promptApprovalId: approvalPlan.promptApprovalId
    })) as MovieErrorResult;

    expect(approvedResult.error).toContain("generation failed");
    expect(new Set(approvedResult.taskIds)).toEqual(new Set(["cgt-1", "cgt-2"]));
    expect(approvedResult.clipPaths).toEqual([]);
    expect(approvedResult.parallel).toEqual({ maxConcurrency: 2 });
    expect(approvedResult.sceneResults.map((scene) => scene.status)).toEqual(["failed", "failed", "skipped"]);
    expect(approvedResult.manifestPath).toMatch(/movie-manifest-.+\.json$/);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });
});
