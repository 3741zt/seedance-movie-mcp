#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBundledNode } from "./node-runtime.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const bundledNode = findBundledNode(projectRoot);
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/run-with-local-node.mjs <script-or-command> [...args]");
  process.exit(1);
}

const nodePath = bundledNode?.nodePath ?? process.execPath;
const pathPrefix = bundledNode?.pathPrefix;
const env = pathPrefix
  ? {
      ...process.env,
      PATH: `${pathPrefix}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`
    }
  : process.env;

const result = spawnSync(nodePath, args, {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  windowsHide: true
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
