import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { randomUUID } from "node:crypto";
import { server } from "../server";

const app = express();
app.use(express.json());

// NOTE ideally we would store this in redis or something
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

app.post("/mcp", async (req, res, next) => {
	const sessionId = req.headers["mcp-session-id"] as string | undefined;
	let transport: StreamableHTTPServerTransport;

	// If the sessionID is set and it's associated with a transport, use it
	if (sessionId && transports[sessionId]) {
		transport = transports[sessionId];

		// if the session id IS NOT available and it's an initialize request, set up a new one
	} else if (!sessionId && isInitializeRequest(req.body)) {
		// Create a new transport with a UUID as sesssion ID; saving it to the transports object
		transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: randomUUID,
			onsessioninitialized(sessionId) {
				transports[sessionId] = transport;
			},
		});

		transport.onclose = () => {
			if (transport.sessionId) delete transports[transport.sessionId];
		};

		// connect to the new server
		await server.connect(transport);
	} else {
		res.status(400).json({
			jsonrpc: "2.0",
			error: {
				code: -32_000,
				message: "Bad request: no valid session ID provided",
			},
			id: null,
		});
		return next();
	}

	await transport.handleRequest(req, res, req.body);
});

// Reusable handler for GET and delete requests

const handleSessionRequest = async (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	const sessionId = req.headers["mcp-session-id"] as string | undefined;
	if (!sessionId || !transports[sessionId]) {
		res.status(400).json({
			jsonrpc: "2.0",
			error: {},
		});
		return next();
	}
	const transport = transports[sessionId];
	await transport.handleRequest(req, res);
};

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

const httpServer = app.listen(process.env.PORT ?? 8000, () => {
	console.log(`Server is running on port ${process.env.PORT ?? 8000}`);
});

httpServer.setTimeout(1_000 * 60 * 60 * 6); // 6 hours
