import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { splitArticleToScenes, splitStoryToScenes, summarizeScenes } from "../src/story.js";

describe("splitStoryToScenes", () => {
  it("uses witty compact storytelling by default", () => {
    const scenes = splitStoryToScenes({
      story: "员工打开系统发现报错。老板突然走进来。员工把锅推给了昨天的自己。",
      sceneCount: 2
    });

    expect(scenes).toHaveLength(2);
    expect(scenes[0].prompt).toContain("叙事风格：诙谐紧凑");
    expect(scenes[0].prompt).toContain("节奏要求：开场即冲突");
    expect(scenes[0].prompt).toContain("笑点/反差：");
    expect(scenes[0].prompt).toContain("口语字幕建议：");
    expect(scenes[1].prompt).toContain("上一段的麻烦继续发酵");
  });

  it("keeps the legacy cinematic style available explicitly", () => {
    const scenes = splitStoryToScenes({
      story:
        "雨夜，侦探在空巷发现一支破损录音笔。他听见录音里传来自己的名字，身后灯光突然熄灭。黑车缓慢停下，车窗后有人举起照片。",
      sceneCount: 3,
      secondsPerScene: 5,
      ratio: "16:9",
      style: "悬疑犯罪电影，低饱和，高反差，浅景深",
      character: "中年男人，黑色风衣，冷峻气质",
      narrativeStyle: "cinematic_default"
    });

    expect(scenes).toHaveLength(3);
    expect(scenes.map((scene) => scene.id)).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(scenes.every((scene) => scene.duration === 5)).toBe(true);
    expect(scenes.every((scene) => scene.ratio === "16:9")).toBe(true);
    expect(scenes[0].prompt).toBe(
      "分镜1，时长5秒，画幅16:9。剧情：雨夜，侦探在空巷发现一支破损录音笔。人物一致性：中年男人，黑色风衣，冷峻气质，服装、年龄、气质、发型和面部特征保持一致。场景：雨夜街巷或剧情指定地点，环境细节服务当前情节。动作：角色缓慢进入画面，发现关键线索并停下。表情：克制警觉，情绪从冷静转为紧绷。镜头语言：电影感开场建立镜头，低机位缓慢推近，浅景深，主体清晰。统一风格：悬疑犯罪电影，低饱和，高反差，浅景深。合规要求：避免色情、违法、真人冒充、明星脸或侵权形象。"
    );
    expect(scenes[1].prompt).toContain("人物一致性：延续同一个人物，中年男人，黑色风衣，冷峻气质");
    expect(scenes[2].prompt).toContain("人物一致性：延续同一个人物，中年男人，黑色风衣，冷峻气质");
    expect(scenes[2].prompt).toContain("镜头语言：");
  });

  it("injects an external story skill file as plain text rules", () => {
    const skillDir = mkdtempSync(path.join(os.tmpdir(), "seedance-story-skill-"));
    const skillPath = path.join(skillDir, "deadpan.md");
    writeFileSync(skillPath, "Use deadpan humor. Every scene must end with a tiny awkward pause.", "utf8");

    const scenes = splitStoryToScenes({
      story: "主角宣布今天一定早睡，下一秒咖啡机自动开机。",
      sceneCount: 1,
      storySkillPath: skillPath
    });

    expect(scenes[0].prompt).toContain("外部叙事 skill：Use deadpan humor. Every scene must end with a tiny awkward pause.");
    expect(scenes[0].prompt).not.toContain("```");
  });

  it("caps scene count at 8 and clamps duration to a generation-friendly range", () => {
    const scenes = splitStoryToScenes({
      story: "一个角色穿过城市，发现线索，并面对选择。",
      sceneCount: 20,
      secondsPerScene: 30,
      ratio: "9:16",
      style: "写实电影",
      character: "年轻女性，红色围巾"
    });

    expect(scenes).toHaveLength(8);
    expect(scenes.every((scene) => scene.duration === 15)).toBe(true);
  });
});

describe("splitArticleToScenes", () => {
  it("infers detailed local prompts from article text without requiring chat-side prompt expansion", () => {
    const scenes = splitArticleToScenes({
      text:
        "Seedance 2.0 API 已全面上线，企业可以把营销文案快速转化为视频。平台支持多模态参考，帮助团队提升内容生产效率并降低返修成本。",
      sceneCount: 2,
      secondsPerScene: 5,
      ratio: "16:9",
      narrativeStyle: "cinematic_default"
    });

    expect(scenes).toHaveLength(2);
    expect(scenes[0].prompt).toContain("创作目标：面向短视频观众");
    expect(scenes[0].prompt).toContain("高端科技商业短片");
    expect(scenes[0].prompt).toContain("关键视觉元素：");
    expect(scenes[0].prompt).toContain("避免字幕页、PPT页面、网页界面和大段文字");
    expect(scenes[1].prompt).toContain("人物/主体一致性：延续同一个人物/主体");

    const summaries = summarizeScenes(scenes);
    expect(summaries).toEqual([
      {
        id: "scene-01",
        duration: 5,
        ratio: "16:9",
        beat: "Seedance 2.0 API 已全面上线，企业可以把营销文案快速转化为视频。"
      },
      {
        id: "scene-02",
        duration: 5,
        ratio: "16:9",
        beat: "平台支持多模态参考，帮助团队提升内容生产效率并降低返修成本。"
      }
    ]);
  });
});
