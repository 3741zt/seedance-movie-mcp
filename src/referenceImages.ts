export interface ReferenceImagePromptInput {
  text: string;
  imageCount?: number;
  ratio?: string;
  style?: string;
  product?: string;
}

export interface ReferenceImagePrompt {
  id: string;
  prompt: string;
  recommendedSize: string;
}

export function buildReferenceImagePrompts(input: ReferenceImagePromptInput): ReferenceImagePrompt[] {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) {
    throw new Error("text is required");
  }

  const count = Math.min(4, Math.max(1, Math.round(input.imageCount ?? 2)));
  const style = input.style?.trim() || "高端电影感广告摄影，真实光影，干净构图，无大段可读文字";
  const ratio = input.ratio?.trim() || "16:9";
  const product = input.product?.trim() || inferImageSubject(text);
  const beats = splitTextForImages(text, count);

  return beats.map((beat, index) => ({
    id: `image-${String(index + 1).padStart(2, "0")}`,
    recommendedSize: imageSizeForRatio(ratio),
    prompt:
      `根据文本内容生成参考图${index + 1}。` +
      `主体：${product}。` +
      `关键信息：${ensureSentenceEnding(beat)}` +
      `风格：${style}。` +
      `画幅：${ratio}。` +
      "要求：真实材质、清晰主体、视觉连续、适合后续作为视频首帧/尾帧/产品参考；不要生成网页界面、字幕页、PPT页面或大段文字。"
  }));
}

function ensureSentenceEnding(value: string): string {
  return /[。！？!?；;.]$/.test(value) ? value : `${value}。`;
}

export function imageSizeForRatio(ratio?: string): string {
  switch (ratio?.trim()) {
    case "9:16":
      return "1024x1536";
    case "1:1":
      return "1024x1024";
    case "16:9":
    default:
      return "1536x1024";
  }
}

function splitTextForImages(text: string, count: number): string[] {
  const sentences = text.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map((item) => item.trim()).filter(Boolean) ?? [text];
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * sentences.length) / count);
    const end = Math.floor(((index + 1) * sentences.length) / count);
    return sentences.slice(start, Math.max(end, start + 1)).join("") || sentences.at(-1) || text;
  });
}

function inferImageSubject(text: string): string {
  if (/果茶|奶茶|饮品|饮料|茶/.test(text)) {
    return "高端果茶产品，新鲜水果、透明杯、分层茶饮、真实水汽与冷凝细节";
  }
  if (/机器人|设备|硬件|产品/.test(text)) {
    return "高端科技产品主体，结构清晰，材质真实，工业设计精致";
  }
  return "文本中最重要的视觉主体";
}
