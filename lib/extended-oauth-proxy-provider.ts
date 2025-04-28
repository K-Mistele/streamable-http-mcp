import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import {
	ProxyOAuthServerProvider,
	type ProxyOptions,
} from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import {
	type OAuthClientInformationFull,
	OAuthClientInformationFullSchema,
	type OAuthTokens,
	OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import createLogger from "logging";
import type { SaveClientInfoFunction } from "./types";

const logger = createLogger("CustomOAuthProxy");

/**
 * This type extends the ProxyOptions to add a saveClient method.
 * This can be provided by the server implementation for storing client information.
 */
export type ExtendedProxyOptions = ProxyOptions & {
	saveClient: SaveClientInfoFunction;
};

/**
 * This class extends the ProxyOAuthServerProvider to add a saveClient method.
 * That can be provided by the server implementation for storing client information.
 *
 * This way we don't have to hard-code return values like in the example
 */
export class ExtendedProxyOAuthServerProvider extends ProxyOAuthServerProvider {
	public readonly saveClientData: SaveClientInfoFunction;

	constructor(options: ExtendedProxyOptions) {
		super(options);
		this.saveClientData = options.saveClient;
	}

	public override get clientsStore(): OAuthRegisteredClientsStore {
		const registrationUrl = this._endpoints.registrationUrl;
		return {
			getClient: this._getClient,
			...(registrationUrl && {
				registerClient: async (client: OAuthClientInformationFull) => {
					const response = await fetch(registrationUrl, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(client),
					});

					if (!response.ok) {
						throw new ServerError(
							`Client registration failed: ${response.status}`,
						);
					}

					const data = await response.json();
					const parsedClient = OAuthClientInformationFullSchema.parse(data);

					/**
					 * NOTE this is the only change to this function from the original implementation
					 * There's nowehere else that this information can be accessed.
					 *
					 * See @file{src/server/auth/handlers/register.ts}
					 */
					await this.saveClientData(parsedClient.client_id, parsedClient);

					return parsedClient;
				},
			}),
		};
	}

	/**
	 * Using this overridden method so we can do some logging and stuff
	 */
	public override async exchangeAuthorizationCode(
		client: OAuthClientInformationFull,
		authorizationCode: string,
		codeVerifier?: string,
	): Promise<OAuthTokens> {
		const redirectUri = client.redirect_uris[0];
		if (redirectUri) {
			logger.debug(
				"Exchanging authorization code with client redirect URI: ",
				redirectUri,
			);
		} else {
			logger.error(
				"No redirect URI found for client",
				client.client_id,
				client,
			);
			throw new ServerError("No redirect URI found for client");
		}
		const params = new URLSearchParams({
			grant_type: "authorization_code",
			client_id: client.client_id,
			redirect_uri: redirectUri,
			code: authorizationCode,
		});

		if (client.client_secret) {
			params.append("client_secret", client.client_secret);
		}

		if (codeVerifier) {
			params.append("code_verifier", codeVerifier);
		}

		const response = await fetch(this._endpoints.tokenUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: params.toString(),
		});

		if (!response.ok) {
			logger.error(
				"Token exchange failed",
				response.status,
				response.statusText,
			);
			logger.error(`JSON:`, await response.json());
			throw new ServerError(`Token exchange failed: ${response.status}`);
		}

		const data = await response.json();
		return OAuthTokensSchema.parse(data);
	}
}
