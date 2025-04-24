import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { z } from "zod";

const server = new McpServer({
	name: "Math-MCP-Server",
	version: "1.0.0",
});

server.tool(
	"add",
	"Add two numbers",
	{ l: z.number(), r: z.number() },
	async ({ l, r }) => ({
		content: [
			{
				type: "text",
				text: String(l + r),
			},
		],
	}),
);

server.tool(
	"divide",
	"Divide two numbers",
	{ l: z.number(), r: z.number() },
	async ({ l, r }) => ({
		content: [
			{
				type: "text",
				text: String(l / r),
			},
		],
	}),
);

// Try stdout transport
const transport = new StdioServerTransport();
await server.connect(transport);
