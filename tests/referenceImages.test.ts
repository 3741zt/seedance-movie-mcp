import { describe, expect, it } from "vitest";
import { buildReferenceImagePrompts } from "../src/referenceImages.js";

describe("buildReferenceImagePrompts", () => {
  it("plans Codex-side reference image prompts without API calls", () => {
    const prompts = buildReferenceImagePrompts({
      text: "苹果果茶新品发布。首图需要新鲜苹果和透明杯。",
      imageCount: 2,
      ratio: "16:9",
      product: "seedance牌苹苹安安苹果果茶"
    });

    expect(prompts).toEqual([
      {
        id: "image-01",
        recommendedSize: "1536x1024",
        prompt:
          "根据文本内容生成参考图1。主体：seedance牌苹苹安安苹果果茶。关键信息：苹果果茶新品发布。风格：高端电影感广告摄影，真实光影，干净构图，无大段可读文字。画幅：16:9。要求：真实材质、清晰主体、视觉连续、适合后续作为视频首帧/尾帧/产品参考；不要生成网页界面、字幕页、PPT页面或大段文字。"
      },
      {
        id: "image-02",
        recommendedSize: "1536x1024",
        prompt:
          "根据文本内容生成参考图2。主体：seedance牌苹苹安安苹果果茶。关键信息：首图需要新鲜苹果和透明杯。风格：高端电影感广告摄影，真实光影，干净构图，无大段可读文字。画幅：16:9。要求：真实材质、清晰主体、视觉连续、适合后续作为视频首帧/尾帧/产品参考；不要生成网页界面、字幕页、PPT页面或大段文字。"
      }
    ]);
  });
});
