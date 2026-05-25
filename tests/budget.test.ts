import { describe, expect, it } from "vitest";
import {
  applyProfileToArticleInput,
  estimateVideoUsage,
  getQualityProfileSettings,
  isEstimatedCostOverLimit
} from "../src/budget.js";
import { splitArticleToScenes } from "../src/story.js";

describe("budget profiles and estimates", () => {
  it("cheap_preview caps scene count, duration, and uses 720p", () => {
    const profile = getQualityProfileSettings("cheap_preview");
    const input = applyProfileToArticleInput(
      {
        text: "一个办公室短剧，角色发现系统崩溃，然后老板出现，最后有人背锅。",
        sceneCount: 8,
        secondsPerScene: 12
      },
      profile
    );
    const scenes = splitArticleToScenes(input);

    expect(profile.resolution).toBe("720p");
    expect(scenes).toHaveLength(3);
    expect(scenes.every((scene) => scene.duration === 4)).toBe(true);
  });

  it("estimates 720p below 1080p and blocks over budget", () => {
    const scenes = [{ duration: 5 }, { duration: 5 }];
    const estimate720p = estimateVideoUsage(scenes, { resolution: "720p" });
    const estimate1080p = estimateVideoUsage(scenes, { resolution: "1080p" });

    expect(estimate720p.estimatedTokens).toBeLessThan(estimate1080p.estimatedTokens);
    expect(isEstimatedCostOverLimit(estimate1080p, 0.1)).toBe(true);
    expect(isEstimatedCostOverLimit(estimate1080p, estimate1080p.estimatedCostCny + 1)).toBe(false);
  });

  it("final_1080p keeps explicitly requested longer scenes within normal limits", () => {
    const profile = getQualityProfileSettings("final_1080p");
    const input = applyProfileToArticleInput(
      {
        text: "一个办公室短剧，角色发现系统崩溃，然后老板出现，最后有人背锅。",
        sceneCount: 4,
        secondsPerScene: 8
      },
      profile
    );
    const scenes = splitArticleToScenes(input);

    expect(scenes).toHaveLength(4);
    expect(scenes.every((scene) => scene.duration === 8)).toBe(true);
  });

  it("final_1080p keeps automatic article scene inference when sceneCount is omitted", () => {
    const profile = getQualityProfileSettings("final_1080p");
    const input = applyProfileToArticleInput(
      {
        text: "第一句。第二句。第三句。第四句。第五句。第六句。第七句。第八句。第九句。第十句。"
      },
      profile
    );
    const scenes = splitArticleToScenes(input);

    expect(scenes).toHaveLength(5);
  });
});
