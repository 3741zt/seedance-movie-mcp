import { describe, expect, it } from "vitest";
import { runBoundedParallel } from "../src/parallel.js";

describe("runBoundedParallel", () => {
  it("limits active work while preserving input order", async () => {
    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];

    const promise = runBoundedParallel([30, 10, 20, 5], 2, async (value, index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
      return `${index}:${value}`;
    });

    expect(maxActive).toBe(2);
    release.shift()?.();
    release.shift()?.();
    await waitFor(() => release.length === 2);
    expect(maxActive).toBe(2);
    release.splice(0).forEach((resolve) => resolve());

    await expect(promise).resolves.toEqual(["0:30", "1:10", "2:20", "3:5"]);
  });

  it("stops scheduling new work after a failure and reports partial results", async () => {
    const started: number[] = [];

    const result = await runBoundedParallel([1, 2, 3, 4], 2, async (value) => {
      started.push(value);
      if (value === 2) {
        throw new Error("scene failed");
      }
      return value * 10;
    });

    expect(result).toEqual([10, undefined, undefined, undefined]);
    expect(started).toEqual([1, 2]);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was not met");
}
