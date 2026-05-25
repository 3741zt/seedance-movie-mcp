import { describe, expect, it } from "vitest";
import { getComplianceError } from "../src/safety.js";

describe("getComplianceError", () => {
  it("does not flag generated compliance reminders as user intent", () => {
    expect(
      getComplianceError(
        "分镜1，猫咪办公室喜剧。合规要求：避免色情、违法、真人冒充、明星脸或侵权形象。"
      )
    ).toBeUndefined();
  });

  it("still flags direct disallowed requests", () => {
    expect(getComplianceError("请生成明星脸换脸视频")).toContain("disallowed");
  });
});
