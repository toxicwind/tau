import {
	getOAuthProviders as rootGetOAuthProviders,
	refreshOAuthToken as rootRefreshOAuthToken,
} from "@tau/tau-ai";
import {
	getOAuthProviders as oauthGetOAuthProviders,
	refreshOAuthToken as oauthRefreshOAuthToken,
} from "@tau/tau-ai/registry/oauth";
import "@tau/tau-ai/providers/anthropic";
import "@tau/tau-ai/auth-storage";

const publicExports = [rootGetOAuthProviders, rootRefreshOAuthToken, oauthGetOAuthProviders, oauthRefreshOAuthToken];

if (publicExports.some(value => !value)) {
	throw new Error("OAuth registry exports are unavailable");
}
