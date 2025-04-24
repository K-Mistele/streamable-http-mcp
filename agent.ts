import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { experimental_createMCPClient as createMcpClient } from "ai";

const mcpClient = await createMcpClient({
	transport: new StreamableHTTPClientTransport(
		new URL("http://localhost:8000/mcp"),
		{
			requestInit: {
				headers: {
					Authorization: "Bearer some-token",
				},
			},
			authProvider: undefined, // TODO add auth provider
		},
	),
});

const tools = await mcpClient.tools();

console.log(tools);
