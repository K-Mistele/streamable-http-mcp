import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { server } from "../server";

const app = express();

app.use(express.json());

app.post("/mcp", async (req: Request, res: Response, next: NextFunction) => {
	console.log("POST /mcp");

	const transport: StreamableHTTPServerTransport =
		new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined, // explicitly disable session ID generation since stateless
		});
	await server.connect(transport);
	await transport.handleRequest(req, res, req.body);

	res.on("close", () => {
		console.log("Closing connection");
		transport.close();
		server.close();
	});
});

app.use("/mcp", async (req: Request, res: Response, next: NextFunction) => {
	if (req.method === "GET" || req.method === "DELETE") {
		console.log(`Unsupported ${req.method} ${req.url} to stateless server`);
		res.writeHead(405).json({
			jsonrpc: "2.0",
			error: {
				code: -32000,
				message: "Method not allowed.",
			},
			id: null,
		});
	}
	return next();
});

// Fall-through error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
	console.error(err);

	if (!res.headersSent) {
		res.status(500).json({
			jsonrpc: "2.0",
			error: {
				code: -32_603,
				message: "internal server error",
			},
			id: null,
		});
		return next();
	}
});

app.listen(process.env.PORT ?? 8000, () => {
	console.log(`Server is running on port ${process.env.PORT ?? 8000}`);
});
