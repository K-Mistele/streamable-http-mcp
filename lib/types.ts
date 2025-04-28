import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

// Define JSON types
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

// Define the type for the save function
export type SaveClientInfoFunction = (
	clientId: string,
	data: JsonObject,
) => Promise<void>;
export type GetClientInfoFunction = (
	clientId: string,
) => Promise<OAuthClientInformationFull | undefined>;
