import { type Clock, type Fetch, signerFromCryptoKey } from "@interopkit/core";
import { createJwksCache } from "@interopkit/tool-integration";
import type { LoginRecord, LtiLaunchOptions, PlatformRegistration } from "@interopkit/tool-integration/tool";

/** The platform as the tool's administrator registered it. */
export interface PlatformSide {
  readonly issuer: string;
  readonly clientId: string;
  readonly deploymentId: string;
  readonly authenticationUrl: string;
  readonly jwksUrl: string;
  readonly accessTokenUrl: string;
}

/** The paths of the tool's login and launch URLs, which the platform's administrator registers. */
export const LOGIN_PATH = "/lti/login";
export const LAUNCH_PATH = "/lti/launch";

/** What the tool is configured with: the options of its functions, which hold its registration, its store and its key set cache. */
export interface ToolSetup {
  /** The options of `ltiLogin`, `ltiLaunch` and `publishAgsScore`. */
  readonly options: LtiLaunchOptions & { readonly fetch: Fetch };
}

/** Configures a tool that trusts one platform and keeps its logins in memory. */
export function setupTool(
  clock: Clock,
  fetch: Fetch,
  origin: string,
  platform: PlatformSide,
  keys: { readonly keyId: string; readonly signingKey: CryptoKey },
): ToolSetup {
  const registration: PlatformRegistration = {
    issuer: platform.issuer,
    clientId: platform.clientId,
    deploymentIds: [platform.deploymentId],
    authenticationUrl: platform.authenticationUrl,
    jwksUrl: platform.jwksUrl,
    accessTokenUrl: platform.accessTokenUrl,
    redirectUri: `${origin}${LAUNCH_PATH}`,
    // The signer could as well call a KMS that holds the key; the platform reads the public key under the keyId.
    signer: signerFromCryptoKey(keys.signingKey, { algorithm: "RS256", keyId: keys.keyId }),
  };
  // The tool keeps the logins in progress in memory; a real tool keeps them where every process can reach them.
  const logins = new Map<string, LoginRecord>();
  const store = {
    put: async (state: string, record: LoginRecord) => void logins.set(state, record),
    get: async (state: string) => logins.get(state),
    delete: async (state: string) => logins.delete(state),
  };
  return {
    options: { registration: async () => registration, clock, store, jwks: createJwksCache({ fetch }), fetch },
  };
}
