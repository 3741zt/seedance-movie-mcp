import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { callTool, isErrorResult, TOOL_DEFINITIONS } from "./tools.js";

export async function startServer(): Promise<void> {
  const server = new Server(
    {
      name: "seedance-movie-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await callTool(request.params.name, request.params.arguments ?? {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ],
        isError: isErrorResult(result)
      };
    } catch (error) {
      const result = {
        error: error instanceof Error ? error.message : String(error)
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ],
        isError: true
      };
    }
  });

  await server.connect(new StdioServerTransport());
}
