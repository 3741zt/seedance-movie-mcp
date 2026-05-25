import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const realGeneration = process.argv.includes("--real");
const approvalArg = process.argv.find((arg) => arg.startsWith("--approval-id="));
const promptApprovalId = approvalArg?.slice("--approval-id=".length);

const client = new Client({ name: "seedance-movie-example", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(projectRoot, "scripts", "start-mcp.mjs")],
  cwd: projectRoot,
  env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined))
});

await client.connect(transport);

try {
  const response = await client.callTool({
    name: "generate_movie_from_text",
    arguments: {
      text: [
        "A developer promises to ship a tiny bug fix before lunch.",
        "The fix accidentally turns into a dramatic office comedy about logs, coffee, and one suspicious progress bar.",
        "Keep the story fast, warm, and slightly absurd."
      ].join(" "),
      qualityProfile: "cheap_preview",
      sceneCount: 3,
      secondsPerScene: 4,
      ratio: "9:16",
      subtitleMode: "manifest",
      maxConcurrency: 2,
      dryRun: !realGeneration,
      promptApprovalId,
      returnPrompts: true,
      outputFileName: "example-preview.mp4",
      outputManifestFileName: "example-preview-manifest.json"
    }
  });

  const text = response.content?.[0]?.text ?? "{}";
  console.log(text);
} finally {
  await client.close();
}
