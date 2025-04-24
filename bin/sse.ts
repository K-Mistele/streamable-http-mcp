import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { server } from "../server";

const app = express();
app.use(express.json());

const transports = {
	// TODO this should go in redis or something.
	sse: {} as Record<string, SSEServerTransport>,
};

app.get("/sse", async (req, res) => {
	const transport = new SSEServerTransport("/messages", res);
	transports.sse[transport.sessionId] = transport;

	res.setTimeout(1_000 * 60 * 60 * 6); // 6 hours

	res.on("close", () => {
		delete transports.sse[transport.sessionId];
	});

	await server.connect(transport);
});

// Legacy message endpoint for older clients
app.post("/messages", async (req, res) => {
	const sessionId = req.query.sessionId as string;
	const transport = transports.sse[sessionId];
	if (transport) {
		await transport.handlePostMessage(req, res, req.body);
	} else {
		res.status(400).send("No transport found for sessionId");
	}
});

const httpServer = app.listen(process.env.PORT ?? 8000, () => {
	console.log(`Server is running on port ${process.env.PORT ?? 8000}`);
});

httpServer.setTimeout(1_000 * 60 * 60 * 6); // 6 hours
