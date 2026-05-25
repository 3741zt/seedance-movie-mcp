import { existsSync } from "node:fs";
import path from "node:path";

export const NODE_VERSION = "v24.16.0";

export function nodeRuntimePlatform(platform = process.platform, arch = process.arch) {
  if (platform === "win32" && arch === "x64") {
    return "win-x64";
  }
  if (platform === "linux" && arch === "x64") {
    return "linux-x64";
  }
  if (platform === "linux" && arch === "arm64") {
    return "linux-arm64";
  }
  if (platform === "darwin" && arch === "arm64") {
    return "darwin-arm64";
  }
  if (platform === "darwin" && arch === "x64") {
    return "darwin-x64";
  }
  throw new Error(`Unsupported Node.js runtime platform: ${platform}/${arch}`);
}

export function nodeArchiveName(version = NODE_VERSION, platform = process.platform, arch = process.arch) {
  const runtimePlatform = nodeRuntimePlatform(platform, arch);
  const extension = platform === "win32" ? "zip" : "tar.xz";
  return `node-${version}-${runtimePlatform}.${extension}`;
}

export function nodeRuntimeDir(projectRoot, version = NODE_VERSION, platform = process.platform, arch = process.arch) {
  return pathForPlatform(platform).join(projectRoot, ".mcp-runtime", `node-${version}-${nodeRuntimePlatform(platform, arch)}`);
}

export function nodeExecutablePath(projectRoot, version = NODE_VERSION, platform = process.platform, arch = process.arch) {
  const runtimeDir = nodeRuntimeDir(projectRoot, version, platform, arch);
  const platformPath = pathForPlatform(platform);
  return platform === "win32" ? platformPath.join(runtimeDir, "node.exe") : platformPath.join(runtimeDir, "bin", "node");
}

export function npmExecutablePath(projectRoot, version = NODE_VERSION, platform = process.platform, arch = process.arch) {
  const runtimeDir = nodeRuntimeDir(projectRoot, version, platform, arch);
  const platformPath = pathForPlatform(platform);
  return platform === "win32" ? platformPath.join(runtimeDir, "npm.cmd") : platformPath.join(runtimeDir, "bin", "npm");
}

export function runtimePathPrefix(projectRoot, version = NODE_VERSION, platform = process.platform, arch = process.arch) {
  const runtimeDir = nodeRuntimeDir(projectRoot, version, platform, arch);
  return platform === "win32" ? runtimeDir : pathForPlatform(platform).join(runtimeDir, "bin");
}

export function findBundledNode(projectRoot, version = NODE_VERSION) {
  try {
    const nodePath = nodeExecutablePath(projectRoot, version);
    const npmPath = npmExecutablePath(projectRoot, version);
    if (existsSync(nodePath) && existsSync(npmPath)) {
      return {
        nodePath,
        npmPath,
        runtimeDir: nodeRuntimeDir(projectRoot, version),
        pathPrefix: runtimePathPrefix(projectRoot, version)
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function pathForPlatform(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}
