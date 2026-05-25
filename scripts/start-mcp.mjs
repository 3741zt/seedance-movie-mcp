#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findBundledNode } from "./node-runtime.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runtimeDir = join(projectRoot, ".mcp-runtime");
const logPath = join(runtimeDir, "start-mcp.log");
const distEntry = join(projectRoot, "dist", "index.js");
const nodeModules = join(projectRoot, "node_modules");
const packageLock = join(projectRoot, "package-lock.json");
const bundledNode = findBundledNode(projectRoot);

mkdirSync(runtimeDir, { recursive: true });

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  appendFileSync(logPath, line);
}

function runLogged(command, args) {
  log(`Running: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    shell: false,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) {
    appendFileSync(logPath, result.stdout);
  }
  if (result.stderr) {
    appendFileSync(logPath, result.stderr);
  }

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}. See ${logPath}`);
  }
}

function latestSourceMtimeMs() {
  const files = [
    join(projectRoot, "package.json"),
    packageLock,
    join(projectRoot, "tsconfig.json"),
    ...listFiles(join(projectRoot, "src"), ".ts")
  ].filter(existsSync);

  return Math.max(...files.map((file) => statSync(file).mtimeMs));
}

function listFiles(dir, extension) {
  if (!existsSync(dir)) {
    return [];
  }

  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFiles(fullPath, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      result.push(fullPath);
    }
  }
  return result;
}

function npmInvocation() {
  if (bundledNode) {
    const npmCli = npmCliPathForBundledNode();
    if (npmCli && existsSync(npmCli)) {
      return {
        command: bundledNode.nodePath,
        argsPrefix: [npmCli]
      };
    }
  }

  const systemNpmCli = npmCliPathForCurrentNode();
  if (systemNpmCli && existsSync(systemNpmCli)) {
    return {
      command: process.execPath,
      argsPrefix: [systemNpmCli]
    };
  }

  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    argsPrefix: []
  };
}

function npmCliPathForBundledNode() {
  if (!bundledNode) {
    return undefined;
  }
  if (process.platform === "win32") {
    return join(dirname(bundledNode.nodePath), "node_modules", "npm", "bin", "npm-cli.js");
  }
  return join(resolve(dirname(bundledNode.nodePath), ".."), "lib", "node_modules", "npm", "bin", "npm-cli.js");
}

function npmCliPathForCurrentNode() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(resolve(dirname(process.execPath), ".."), "lib", "node_modules", "npm", "bin", "npm-cli.js")
  ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);

  return candidates.find((candidate) => existsSync(candidate));
}

function shouldRespawnWithBundledNode() {
  if (!bundledNode) {
    return false;
  }
  return resolve(process.execPath).toLowerCase() !== resolve(bundledNode.nodePath).toLowerCase();
}

function respawnWithBundledNode() {
  log(`Respawning with bundled Node: ${bundledNode.nodePath}`);
  const result = spawnSync(bundledNode.nodePath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${bundledNode.pathPrefix}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`
    },
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

try {
  log("Starting Seedance Movie MCP launcher");

  if (shouldRespawnWithBundledNode()) {
    respawnWithBundledNode();
  }

  const needsInstall =
    !existsSync(nodeModules) ||
    (existsSync(packageLock) && statSync(packageLock).mtimeMs > statSync(nodeModules).mtimeMs);

  if (needsInstall) {
    const npm = npmInvocation();
    runLogged(npm.command, [...npm.argsPrefix, "install"]);
  }

  const needsBuild = !existsSync(distEntry) || latestSourceMtimeMs() > statSync(distEntry).mtimeMs;
  if (needsBuild) {
    const npm = npmInvocation();
    runLogged(npm.command, [...npm.argsPrefix, "run", "build"]);
  }

  if (process.argv.includes("--check")) {
    log("Check completed");
    process.exit(0);
  }

  log("Launching MCP server");
  await import(pathToFileURL(distEntry).href);
} catch (error) {
  log(`Launcher failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Seedance Movie MCP launcher failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
