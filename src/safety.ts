const DISALLOWED_PATTERNS = [
  /色情|性爱|性行为|裸露|脱衣|强奸|未成年.*性|儿童.*性/i,
  /明星脸|名人脸|真人冒充|冒充真人|deepfake|换脸/i,
  /制作炸弹|爆炸物教程|制毒|贩毒|枪支制造|逃避执法/i
];

export function getComplianceError(text: string): string | undefined {
  const normalized = stripGeneratedComplianceClauses(text).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  return DISALLOWED_PATTERNS.some((pattern) => pattern.test(normalized))
    ? "Input appears to request disallowed sexual, illegal, real-person impersonation, celebrity-face, or infringement content."
    : undefined;
}

function stripGeneratedComplianceClauses(text: string): string {
  return text.replace(/合规要求：避免[^。]*(?:。|$)/g, "");
}
