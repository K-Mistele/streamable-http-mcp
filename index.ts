import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { Redis } from "ioredis";
import createLogger from "logging";
import { randomUUID } from "node:crypto";
import { ExtendedProxyOAuthServerProvider } from "./lib/extended-oauth-proxy-provider";
import { server } from "./server";

config();

const logger = createLogger(__filename.split("/").pop() ?? "", {
	debugFunction: (...args) => {
		console.log(...args);
	},
});

const redis = new Redis({
	host: "localhost",
	port: 6379,
});
redis.on("connecting", () => logger.debug("Redis connecting..."));
redis.on("connect", () => logger.info("Redis connected!"));
redis.on("error", (err) => logger.error("Redis error", err));
redis.on("close", () => logger.info("Redis closed!"));

const {
	OAUTH_CLIENT_ID,
	OAUTH_CLIENT_SECRET,
	OAUTH_ISSUER_URL,
	OAUTH_AUTHORIZATION_URL,
	OAUTH_TOKEN_URL,
	OAUTH_REVOCATION_URL,
	OAUTH_REGISTRATION_URL,
	THIS_HOSTNAME,
} = process.env;

if (
	!OAUTH_CLIENT_ID ||
	!OAUTH_CLIENT_SECRET ||
	!OAUTH_ISSUER_URL ||
	!OAUTH_AUTHORIZATION_URL ||
	!OAUTH_TOKEN_URL ||
	!OAUTH_REGISTRATION_URL ||
	!THIS_HOSTNAME
) {
	throw new Error("Missing environment variables");
}

// NOTE ideally we don't do this in memory since it's not horizontally scalable easily
// but these are stateful objects with connections from the client so they can't just
// be written to a database.
const transports: {
	sse: { [sessionId: string]: SSEServerTransport };
	streamable: { [sessionId: string]: StreamableHTTPServerTransport };
} = {
	sse: {},
	streamable: {},
};

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

/**
 * Set up the OAuth Proxy provider; configured in .env to use Naptha's Auth0 tenant
 */
const proxyProvider = new ExtendedProxyOAuthServerProvider({
	endpoints: {
		authorizationUrl: `${OAUTH_AUTHORIZATION_URL}`,
		tokenUrl: `${OAUTH_TOKEN_URL}`,
		revocationUrl: OAUTH_REVOCATION_URL,
		registrationUrl: `${OAUTH_REGISTRATION_URL}`,
	},
	verifyAccessToken: async (token) => {
		logger.debug("verifyAccessToken", token);
		return {
			token,
			clientId: `${OAUTH_CLIENT_ID}`,
			scopes: [
				"openid", // OIDC, returns `sub` claim
				"email", // duh
				"profile", // name, picture, etc.
			],
		};
	},
	getClient: async (client_id) => {
		// Necessary to support mcp-remote since it uses a custom redirect_uri each time
		// The example hard-codes the redirect_uri; this isn't realistic
		logger.debug("getClient", client_id);

		logger.debug("GetClient", client_id);
		const clientInfo = await redis.get(client_id);

		logger.debug("GetClient response:", clientInfo);
		if (!clientInfo) {
			return undefined;
		}
		return JSON.parse(clientInfo);
	},
	saveClient: async (client_id, client_info) => {
		// Necessary to serialize & save the registered client information
		logger.debug("saveClient", client_id, client_info);
		await redis.set(client_id, JSON.stringify(client_info));
	},
});

/**
 * Mount the auth router
 */
app.use(
	mcpAuthRouter({
		provider: proxyProvider,
		issuerUrl: new URL(`${OAUTH_ISSUER_URL}`), // address of issuer, auth0
		baseUrl: new URL(`${THIS_HOSTNAME}`), // address of local server
	}),
);

/**
 * Set up the SSE MCP router
 */
app.get(
	"/sse",
	requireBearerAuth({ provider: proxyProvider }),
	async (req, res) => {
		logger.debug("SSE headers:", req.headers);
		logger.debug("SSE body:", req.body);

		const transport = new SSEServerTransport("/messages", res);
		transports.sse[transport.sessionId] = transport;

		res.setTimeout(1_000 * 60 * 60 * 6); // 6 hours

		res.on("close", () => {
			delete transports.sse[transport.sessionId];
		});

		await server.connect(transport);
	},
);

// Legacy message endpoint for older clients
app.post(
	"/messages",
	requireBearerAuth({ provider: proxyProvider }),
	async (req, res) => {
		const sessionId = req.query.sessionId as string;
		logger.debug("SSE", sessionId, "Received message");
		const transport = transports.sse[sessionId];
		if (transport) {
			logger.debug("SSE", sessionId, "Transport found for sessionId");
			await transport.handlePostMessage(req, res, req.body);
			logger.debug(
				"SSE",
				sessionId,
				"Message handled by transport for sessionId",
			);
		} else {
			logger.warn("SSE", sessionId, "No transport found for sessionId");
			res.status(400).send("No transport found for sessionId");
		}
	},
);

/**
 * Set up the streamable HTTP MCP router
 */
app.post("/mcp", async (req, res, next) => {
	const sessionId = req.headers["mcp-session-id"] as string | undefined;
	logger.info("Streamable", sessionId, "Received message");
	let transport: StreamableHTTPServerTransport;

	// If the sessionID is set and it's associated with a transport, use it
	if (sessionId && transports.streamable[sessionId]) {
		transport = transports.streamable[sessionId];
		logger.info("Streamable", sessionId, "Transport found for sessionId");

		// if the session id IS NOT available and it's an initialize request, set up a new one
	} else if (!sessionId && isInitializeRequest(req.body)) {
		// Create a new transport with a UUID as sesssion ID; saving it to the transports object
		transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: randomUUID,
			onsessioninitialized(sessionId) {
				transports.streamable[sessionId] = transport;
			},
		});

		transport.onclose = () => {
			if (transport.sessionId)
				delete transports.streamable[transport.sessionId];
		};
		logger.info("Streamable", transport.sessionId, "Transport constructed");

		// connect to the new server
		await server.connect(transport);
		logger.info(
			"Streamable",
			transport.sessionId,
			"Server connected to transport",
		);
	} else {
		logger.warn("Streamable", sessionId, "No transport found for sessionId");
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
	logger.info("Streamable", sessionId, "Message handled by transport");
});

// Reusable handler for GET and delete requests

const handleSessionRequest = async (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	const sessionId = req.headers["mcp-session-id"] as string | undefined;
	if (!sessionId || !transports.streamable[sessionId]) {
		logger.warn("Streamable", sessionId, "No transport found for sessionId");
		res.status(400).json({
			jsonrpc: "2.0",
			error: {},
		});
		return next();
	}
	const transport = transports.streamable[sessionId];
	await transport.handleRequest(req, res);
};

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
	logger.info("Error", error);
	if (!res.headersSent) {
		res.status(500).json({
			jsonrpc: "2.0",
			error: {
				code: -32_000,
				message: "Internal server error",
			},
		});
	} else {
		logger.warn("headers already sent so no response sent");
	}
});
const httpServer = app.listen(process.env.PORT ?? 5050, () => {
	logger.info(`Server is running on port ${process.env.PORT ?? 5050}`);
});

//httpServer.setTimeout(1_000 * 60 * 60 * 6); // 6 hours
