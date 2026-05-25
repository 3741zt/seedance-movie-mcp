import { readFileSync } from "node:fs";
import path from "node:path";

export interface SplitStoryInput {
  story: string;
  sceneCount?: number;
  secondsPerScene?: number;
  ratio?: string;
  style?: string;
  character?: string;
  narrativeStyle?: string;
  storySkillPath?: string;
}

export interface SplitArticleInput {
  text: string;
  sceneCount?: number;
  secondsPerScene?: number;
  ratio?: string;
  style?: string;
  character?: string;
  audience?: string;
  visualGoal?: string;
  narrativeStyle?: string;
  storySkillPath?: string;
}

export interface ScenePrompt {
  id: string;
  duration: number;
  ratio: string;
  prompt: string;
}

export interface SceneSummary {
  id: string;
  duration: number;
  ratio: string;
  beat: string;
}

const DEFAULT_SCENE_COUNT = 3;
const MAX_SCENE_COUNT = 8;
const DEFAULT_SECONDS_PER_SCENE = 5;
const MIN_SECONDS_PER_SCENE = 4;
const MAX_SECONDS_PER_SCENE = 15;
const DEFAULT_RATIO = "16:9";
const DEFAULT_STYLE = "电影感写实，统一色调，浅景深，稳定构图";
const DEFAULT_CHARACTER = "主要人物，外貌、服装、年龄、气质和面部特征保持一致";
const DEFAULT_NARRATIVE_STYLE = "witty_compact";
const STORY_SKILL_ENV = "SEEDANCE_STORY_SKILL_PATH";
const MAX_STORY_SKILL_CHARS = 6_000;

const SCENE_TEMPLATES = [
  {
    scene: "雨夜街巷或剧情指定地点，环境细节服务当前情节",
    action: "角色缓慢进入画面，发现关键线索并停下",
    expression: "克制警觉，情绪从冷静转为紧绷",
    camera: "电影感开场建立镜头，低机位缓慢推近，浅景深，主体清晰"
  },
  {
    scene: "同一城市空间的相邻地点，光线更暗，背景保持连贯",
    action: "角色靠近线索源头，回头确认身后的异动",
    expression: "疑惑加深，眼神出现不安和怀疑",
    camera: "中近景跟拍，轻微手持晃动，缓慢横移制造压迫感"
  },
  {
    scene: "冲突即将爆发的街口或室内阴影区，保留前段线索",
    action: "角色直面新的威胁或决定，动作短促而克制",
    expression: "警觉转为决断，眉眼紧绷",
    camera: "近景切入面部，随后快速拉开露出环境关系，高反差照明"
  },
  {
    scene: "更封闭的空间或更深的夜色中，前景遮挡制造层次",
    action: "角色追踪目标或保护关键物件，脚步加快",
    expression: "焦虑被压住，保持冷静判断",
    camera: "侧后方跟拍，前景掠过，节奏比前段更紧"
  },
  {
    scene: "剧情核心地点，光影形成强烈明暗分区",
    action: "角色停住并做出选择，手部动作强调关键转折",
    expression: "从犹豫转为坚定，呼吸变浅",
    camera: "特写手部后切到眼神，短焦压缩空间，制造临场感"
  },
  {
    scene: "危机升级的地点，背景人物或物件只做弱化处理",
    action: "角色与压力源正面对峙，身体姿态收紧",
    expression: "压抑愤怒，眼神锐利",
    camera: "低角度对峙镜头，缓慢推近到半身近景"
  },
  {
    scene: "接近结局的开阔或空旷场景，保留统一美术风格",
    action: "角色完成关键动作，局势开始反转",
    expression: "紧张后出现短暂释然，但仍保持警惕",
    camera: "从近景后退到中远景，展现场景后果和人物孤立感"
  },
  {
    scene: "收束性的终局场景，环境回扣第一段视觉元素",
    action: "角色回望或离开画面，留下悬念物件",
    expression: "冷静复杂，情绪收回眼底",
    camera: "稳定长镜头缓慢拉远，留出余韵，画面干净有电影结尾感"
  }
] as const;

const WITTY_SCENE_TEMPLATES = [
  {
    scene: "与剧情直接相关的日常空间，保留一个醒目小道具制造反差",
    action: "角色刚想掌控局面，麻烦立刻以更离谱但可理解的方式出现",
    expression: "表面镇定，眼神暴露慌张，反应要快",
    camera: "中近景直接进冲突，轻快推近，结尾留半秒尴尬停顿",
    gag: "角色越解释越像在给自己挖坑",
    subtitle: "先别慌，问题只是学会了加戏"
  },
  {
    scene: "同一空间的相邻区域，前一段的麻烦被放大成更明显的局面",
    action: "角色试图补救，却把一个小问题补成全场焦点",
    expression: "努力保持专业，嘴角和眼神露出心虚",
    camera: "快速横移跟拍，切到道具或反应特写，节奏短促",
    gag: "上一段的麻烦继续发酵，补救动作反而制造新误会",
    subtitle: "这不是失误，这是失误的连续剧"
  },
  {
    scene: "冲突最集中的位置，画面干净，让角色和小道具成为笑点中心",
    action: "角色做出一本正经的决定，结果立刻被现实轻轻打脸",
    expression: "认真到好笑，随后出现短促愣住",
    camera: "近景切表情，再拉开露出反差原因，留出喜剧节拍",
    gag: "一本正经的计划被一个很小的细节击穿",
    subtitle: "计划很完整，只是现实没报名"
  },
  {
    scene: "收束性的地点，回扣第一段的小道具或误会",
    action: "角色假装一切都在掌控中，最后留下一个轻巧反转",
    expression: "松一口气，又被最后的小意外定住",
    camera: "稳定中景收束，最后用特写落到反转物件",
    gag: "结尾把锅轻轻递回角色手里",
    subtitle: "今天的结论：别和小问题讲道理"
  }
] as const;

export function splitStoryToScenes(input: SplitStoryInput): ScenePrompt[] {
  const story = normalizeWhitespace(input.story);
  if (!story) {
    throw new Error("story is required");
  }

  const sceneCount = clampInteger(input.sceneCount ?? DEFAULT_SCENE_COUNT, 1, MAX_SCENE_COUNT);
  const duration = clampInteger(
    input.secondsPerScene ?? DEFAULT_SECONDS_PER_SCENE,
    MIN_SECONDS_PER_SCENE,
    MAX_SECONDS_PER_SCENE
  );
  const ratio = normalizeWhitespace(input.ratio ?? DEFAULT_RATIO);
  const style = normalizeWhitespace(input.style ?? DEFAULT_STYLE);
  const character = normalizeWhitespace(input.character ?? DEFAULT_CHARACTER);
  const beats = distributeSentences(splitIntoSentences(story), sceneCount, story);
  const narrative = resolveNarrativeSettings(input.narrativeStyle, input.storySkillPath);
  const templates = narrative.styleId === "cinematic_default" ? SCENE_TEMPLATES : WITTY_SCENE_TEMPLATES;

  return beats.map((beat, index) => {
    const template = templates[index % templates.length]!;
    const characterContinuity =
      index === 0
        ? `${character}，服装、年龄、气质、发型和面部特征保持一致`
        : `延续同一个人物，${character}，服装、年龄、气质、发型和面部特征保持一致`;

    return {
      id: `scene-${String(index + 1).padStart(2, "0")}`,
      duration,
      ratio,
      prompt:
        `分镜${index + 1}，时长${duration}秒，画幅${ratio}。` +
        `剧情：${ensureSentenceEnding(beat)}` +
        `人物一致性：${characterContinuity}。` +
        `场景：${template.scene}。` +
        `动作：${template.action}。` +
        `表情：${template.expression}。` +
        `镜头语言：${template.camera}。` +
        `统一风格：${style}。` +
        buildNarrativePromptBlock(narrative, template) +
        "合规要求：避免色情、违法、真人冒充、明星脸或侵权形象。"
    };
  });
}

export function splitArticleToScenes(input: SplitArticleInput): ScenePrompt[] {
  const text = normalizeWhitespace(input.text);
  if (!text) {
    throw new Error("text is required");
  }

  const sceneCount = clampInteger(input.sceneCount ?? inferSceneCount(text), 1, MAX_SCENE_COUNT);
  const duration = clampInteger(
    input.secondsPerScene ?? DEFAULT_SECONDS_PER_SCENE,
    MIN_SECONDS_PER_SCENE,
    MAX_SECONDS_PER_SCENE
  );
  const ratio = normalizeWhitespace(input.ratio ?? DEFAULT_RATIO);
  const keywords = extractKeywords(text);
  const style = normalizeWhitespace(input.style ?? inferStyle(text));
  const character = normalizeWhitespace(input.character ?? inferSubject(text, keywords));
  const audience = normalizeWhitespace(input.audience ?? "短视频观众");
  const visualGoal = normalizeWhitespace(input.visualGoal ?? inferVisualGoal(text));
  const beats = distributeSentences(splitIntoSentences(text), sceneCount, text);
  const narrative = resolveNarrativeSettings(input.narrativeStyle, input.storySkillPath);
  const templates = narrative.styleId === "cinematic_default" ? SCENE_TEMPLATES : WITTY_SCENE_TEMPLATES;

  return beats.map((beat, index) => {
    const template = templates[index % templates.length]!;
    const continuity =
      index === 0
        ? `${character}，核心主体、造型、色彩、材质和视觉识别保持一致`
        : `延续同一个人物/主体，${character}，核心主体、造型、色彩、材质和视觉识别保持一致`;

    return {
      id: `scene-${String(index + 1).padStart(2, "0")}`,
      duration,
      ratio,
      prompt:
        `分镜${index + 1}，时长${duration}秒，画幅${ratio}。` +
        `原文信息提炼：${ensureSentenceEnding(beat)}` +
        `创作目标：面向${audience}，把文章观点转化成可观看的电影化画面，${visualGoal}。` +
        `人物/主体一致性：${continuity}。` +
        `关键视觉元素：${keywords.join("、")}。` +
        `场景：${adaptSceneForArticle(template.scene, beat)}。` +
        `动作：${adaptActionForArticle(template.action, beat)}。` +
        `表情/状态：${adaptExpressionForArticle(template.expression, beat)}。` +
        `镜头语言：${template.camera}，避免字幕页、PPT页面、网页界面和大段文字。` +
        `统一风格：${style}。` +
        buildNarrativePromptBlock(narrative, template) +
        "合规要求：避免色情、违法、真人冒充、明星脸或侵权形象。"
    };
  });
}

export function summarizeScenes(scenes: ScenePrompt[], includePrompts = false): Array<SceneSummary | ScenePrompt> {
  if (includePrompts) {
    return scenes;
  }

  return scenes.map((scene) => ({
    id: scene.id,
    duration: scene.duration,
    ratio: scene.ratio,
    beat: extractPromptField(scene.prompt, "原文信息提炼") ?? extractPromptField(scene.prompt, "剧情") ?? scene.id
  }));
}

function splitIntoSentences(story: string): string[] {
  const matches = story.match(/[^。！？!?；;]+[。！？!?；;]?/g);
  const sentences = matches?.map((part) => normalizeWhitespace(part)).filter(Boolean) ?? [];
  return sentences.length > 0 ? sentences : [story];
}

function inferSceneCount(text: string): number {
  const sentenceCount = splitIntoSentences(text).length;
  return clampInteger(Math.ceil(sentenceCount / 2), DEFAULT_SCENE_COUNT, MAX_SCENE_COUNT);
}

function inferStyle(text: string): string {
  if (/悬疑|犯罪|侦探|案件|秘密|危机|真相/.test(text)) {
    return "悬疑犯罪电影，低饱和，高反差，浅景深，克制紧张";
  }
  if (/科技|模型|API|机器人|数据|算法|智能|平台|产品|商业|企业/.test(text)) {
    return "高端科技商业短片，冷暖对比，真实质感，精密光影，电影级运镜";
  }
  if (/历史|文化|传统|古城|非遗|诗|山水/.test(text)) {
    return "东方人文纪录片，细腻光影，沉稳构图，真实质感，诗性叙事";
  }
  if (/爱情|亲情|家庭|回忆|离别|治愈/.test(text)) {
    return "情绪电影短片，柔和自然光，细腻表演，温暖但不过曝";
  }
  if (/战争|灾难|风暴|暴雨|大雾|冲突|爆发/.test(text)) {
    return "灾难现实主义电影，强动态，压迫感构图，高反差光影";
  }
  return DEFAULT_STYLE;
}

function inferSubject(text: string, keywords: string[]): string {
  if (/产品|品牌|营销|广告|商业/.test(text)) {
    return `核心产品或品牌视觉主体${keywords[0] ? `“${keywords[0]}”` : ""}，干净高级，材质真实，视觉识别统一`;
  }
  if (/机器人|具身|训练|仿真/.test(text)) {
    return "一台工业级智能机器人或数字化训练主体，结构清晰，运动稳定，科技感强";
  }
  if (/企业|团队|创作者|平台|用户/.test(text)) {
    return "一位专业创作者或企业团队代表，现代服装，专注可信，气质沉稳";
  }
  if (/侦探|警察|男人|女人|少年|女孩|老人/.test(text)) {
    return "文章中的主要人物，外貌、服装、年龄、气质和面部特征保持一致";
  }
  return DEFAULT_CHARACTER;
}

function inferVisualGoal(text: string): string {
  if (/提升|增长|效率|降本|转化|生产力/.test(text)) {
    return "突出效率提升、生产流程变化和结果落地";
  }
  if (/上线|发布|开放|接入|API/.test(text)) {
    return "突出能力发布、技术接入和真实应用场景";
  }
  if (/挑战|痛点|问题|风险/.test(text)) {
    return "先呈现问题压力，再呈现解决方案";
  }
  return "突出核心信息、情绪变化和视觉记忆点";
}

function extractKeywords(text: string): string[] {
  const quoted = Array.from(text.matchAll(/[《“"]([^《》“”"]{2,18})[》”"]/g), (match) => match[1]!);
  const terms = Array.from(
    text.matchAll(/[A-Za-z][A-Za-z0-9.+-]{1,24}|[\u4e00-\u9fa5]{2,10}(?:API|模型|平台|视频|创作|生成|能力|场景|工作流|企业|产品|技术|数据|短片|分镜|镜头)/g),
    (match) => match[0]
  );
  const fallback = splitIntoSentences(text)
    .slice(0, 3)
    .flatMap((sentence) => sentence.match(/[\u4e00-\u9fa5]{2,6}/g) ?? []);
  const unique = [...quoted, ...terms, ...fallback]
    .map((item) => normalizeWhitespace(item).replace(/[，。！？、；：,.!?;:]/g, ""))
    .filter((item) => item.length >= 2 && !STOP_WORDS.has(item));

  return Array.from(new Set(unique)).slice(0, 8).concat(["电影感", "真实光影"]).slice(0, 8);
}

function adaptSceneForArticle(scene: string, beat: string): string {
  if (/API|模型|平台|技术|数据|企业|产品/.test(beat)) {
    return "现代创意工作室、服务器机房、产品拍摄现场或数字化生产空间，界面元素只做抽象光影，不出现可读大段文字";
  }
  if (/城市|街|雨|夜|车/.test(beat)) {
    return scene;
  }
  return "与原文主题相关的真实场景，前景、中景、背景层次清晰，细节服务当前观点";
}

function adaptActionForArticle(action: string, beat: string): string {
  if (/报错|失败|崩溃|延迟|故障|返修|成本|效率/.test(beat)) {
    return "主体用很认真但略显手忙脚乱的方式处理问题，动作短促，制造轻松反差";
  }
  if (/提升|增长|降本|效率|生产力/.test(beat)) {
    return "主体从复杂低效的状态转向顺畅运转，动作体现流程加速和结果出现";
  }
  if (/上线|发布|开放|接入|API/.test(beat)) {
    return "主体启动系统、连接流程或展示能力落地，动作简洁有确定性";
  }
  return action;
}

function adaptExpressionForArticle(expression: string, beat: string): string {
  if (/报错|失败|崩溃|延迟|故障|返修|成本|效率/.test(beat)) {
    return "表面镇定，眼神出现短促心虚，随后用轻松反应化解压力";
  }
  if (/危机|问题|痛点|风险|困难/.test(beat)) {
    return "克制紧张，随后出现解决问题的专注感";
  }
  if (/提升|增长|成功|突破|优势/.test(beat)) {
    return "专注、自信，情绪从观察转为笃定";
  }
  return expression;
}

interface NarrativeSettings {
  styleId: "witty_compact" | "cinematic_default" | "custom";
  label: string;
  customStyle?: string;
  externalSkill?: string;
}

function resolveNarrativeSettings(narrativeStyle: string | undefined, storySkillPath: string | undefined): NarrativeSettings {
  const normalizedStyle = normalizeWhitespace(narrativeStyle ?? DEFAULT_NARRATIVE_STYLE).toLowerCase();
  const externalSkill = readExternalStorySkill(storySkillPath);
  if (normalizedStyle === "cinematic_default") {
    return {
      styleId: "cinematic_default",
      label: "电影默认",
      externalSkill
    };
  }
  if (normalizedStyle === "witty_compact" || normalizedStyle === "humor" || normalizedStyle === "comedy") {
    return {
      styleId: "witty_compact",
      label: "诙谐紧凑",
      externalSkill
    };
  }
  return {
    styleId: "custom",
    label: "自定义",
    customStyle: normalizeWhitespace(narrativeStyle ?? DEFAULT_NARRATIVE_STYLE),
    externalSkill
  };
}

function buildNarrativePromptBlock(
  narrative: NarrativeSettings,
  template: (typeof SCENE_TEMPLATES)[number] | (typeof WITTY_SCENE_TEMPLATES)[number]
): string {
  const externalSkill = narrative.externalSkill ? `外部叙事 skill：${narrative.externalSkill}。` : "";
  if (narrative.styleId === "cinematic_default") {
    return externalSkill;
  }

  const customStyle = narrative.customStyle ? `自定义叙事要求：${narrative.customStyle}。` : "";
  const gag = "gag" in template ? template.gag : "用一个轻微反差让剧情推进，不靠解释撑时长";
  const subtitle = "subtitle" in template ? template.subtitle : "事情不大，但它很会挑时间";
  return (
    `叙事风格：${narrative.label}。` +
    "节奏要求：开场即冲突，每段只保留一个明确动作，结尾给轻反转或停顿，不拖沓解释。" +
    `笑点/反差：${gag}。` +
    `口语字幕建议：${subtitle}。` +
    customStyle +
    externalSkill
  );
}

function readExternalStorySkill(storySkillPath: string | undefined): string | undefined {
  const configuredPath = normalizeWhitespace(storySkillPath ?? process.env[STORY_SKILL_ENV] ?? "");
  if (!configuredPath) {
    return undefined;
  }
  const resolvedPath = path.resolve(configuredPath);
  const raw = readFileSync(resolvedPath, "utf8");
  return normalizeWhitespace(raw.replace(/```/g, "")).slice(0, MAX_STORY_SKILL_CHARS);
}

function extractPromptField(prompt: string, fieldName: string): string | undefined {
  const match = prompt.match(new RegExp(`${fieldName}：([^。]+。)`));
  return match?.[1];
}

function distributeSentences(sentences: string[], sceneCount: number, fallback: string): string[] {
  return Array.from({ length: sceneCount }, (_, index) => {
    const start = Math.floor((index * sentences.length) / sceneCount);
    const end = Math.floor(((index + 1) * sentences.length) / sceneCount);
    const segment = sentences.slice(start, Math.max(end, start + 1)).join("");
    return segment || sentences.at(-1) || fallback;
  });
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function ensureSentenceEnding(value: string): string {
  return /[。！？!?；;.]$/.test(value) ? value : `${value}。`;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

const STOP_WORDS = new Set([
  "这个",
  "一个",
  "可以",
  "通过",
  "支持",
  "进行",
  "实现",
  "用户",
  "内容",
  "文章",
  "能力"
]);
