/**
 * Re-exports from @tau/tau-ai.
 * All credential storage types and the AuthStorage class now live in the ai package.
 */

export type {
	ApiKeyCredential,
	AuthCredential,
	AuthCredentialEntry,
	AuthCredentialStore,
	AuthStorageData,
	AuthStorageOptions,
	CredentialOrigin,
	CredentialOriginKind,
	OAuthAccountIdentity,
	OAuthAccountSummary,
	OAuthCredential,
	ResetCreditAccountStatus,
	ResetCreditRedeemOutcome,
	ResetCreditTarget,
	StoredAuthCredential,
} from "@tau/tau-ai";
export { AuthStorage, REMOTE_REFRESH_SENTINEL, SqliteAuthCredentialStore } from "@tau/tau-ai";
export type { SnapshotResponse } from "@tau/tau-ai/auth-broker/types";
