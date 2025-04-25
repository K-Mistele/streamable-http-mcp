import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	ensureLogDirectory,
	registerExitHandlers,
	scheduleLogRotation,
	setupLogRotation,
} from "./logging.js";
import { createServer } from "./server.js";

// Run setup for logging
ensureLogDirectory();
setupLogRotation();
scheduleLogRotation();
registerExitHandlers();

async function runServer() {
	const server = createServer();
	const transport = new StdioServerTransport();

	await server.connect(transport);

	server.sendLoggingMessage({
		level: "info",
		data: "Stagehand MCP server is ready to accept requests",
	});
}

runServer().catch((error: any) => {
	const errorMsg = error instanceof Error ? error.message : String(error);
	console.error(errorMsg);
});
