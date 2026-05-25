import { describe, expect, it } from "vitest";
import {
  nodeArchiveName,
  nodeExecutablePath,
  nodeRuntimeDir,
  nodeRuntimePlatform,
  npmExecutablePath,
  runtimePathPrefix
} from "../scripts/node-runtime.mjs";

describe("node runtime path helpers", () => {
  it("resolves Windows x64 runtime paths", () => {
    const root = "C:\\repo\\seedance";
    expect(nodeRuntimePlatform("win32", "x64")).toBe("win-x64");
    expect(nodeArchiveName("v24.16.0", "win32", "x64")).toBe("node-v24.16.0-win-x64.zip");
    expect(nodeRuntimeDir(root, "v24.16.0", "win32", "x64")).toContain("node-v24.16.0-win-x64");
    expect(nodeExecutablePath(root, "v24.16.0", "win32", "x64")).toMatch(/node-v24\.16\.0-win-x64[\\/]node\.exe$/);
    expect(npmExecutablePath(root, "v24.16.0", "win32", "x64")).toMatch(/node-v24\.16\.0-win-x64[\\/]npm\.cmd$/);
    expect(runtimePathPrefix(root, "v24.16.0", "win32", "x64")).toMatch(/node-v24\.16\.0-win-x64$/);
  });

  it("resolves Linux x64 runtime paths", () => {
    const root = "/opt/seedance";
    expect(nodeRuntimePlatform("linux", "x64")).toBe("linux-x64");
    expect(nodeArchiveName("v24.16.0", "linux", "x64")).toBe("node-v24.16.0-linux-x64.tar.xz");
    expect(nodeRuntimeDir(root, "v24.16.0", "linux", "x64")).toBe("/opt/seedance/.mcp-runtime/node-v24.16.0-linux-x64");
    expect(nodeExecutablePath(root, "v24.16.0", "linux", "x64")).toBe(
      "/opt/seedance/.mcp-runtime/node-v24.16.0-linux-x64/bin/node"
    );
    expect(npmExecutablePath(root, "v24.16.0", "linux", "x64")).toBe(
      "/opt/seedance/.mcp-runtime/node-v24.16.0-linux-x64/bin/npm"
    );
    expect(runtimePathPrefix(root, "v24.16.0", "linux", "x64")).toBe(
      "/opt/seedance/.mcp-runtime/node-v24.16.0-linux-x64/bin"
    );
  });
});
