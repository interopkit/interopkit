import type { Clock } from "@interopkit/core";
import { createJwksCache, type JwksCache } from "@interopkit/tool-integration";
import {
  type PlatformConfig,
  type PlatformOptions,
  platformEndpoints,
  type ToolRegistration,
} from "@interopkit/tool-integration/platform";
import { generateHintKey, generateSigningKeys } from "./keys.ts";

/** What the platform knows of the tool: the tool's side of the registration. */
export interface ToolSide {
  readonly clientId: string;
  readonly deploymentId: string;
  readonly loginUrl: string;
  readonly redirectUri: string;
  /** The tool's public key, which the platform has instead of a URL of the tool's key set. */
  readonly keyId: string;
  readonly publicKey: CryptoKey;
}

/** The issuer of the platform, which is also its origin. */
export const ISSUER = "https://lms.example";
const FRAME_ORIGIN = "https://app.lms.example";

/** What the platform is configured with: its options, its registration of the tool, and the ledger of single-use identifiers. */
export interface PlatformSetup {
  /** The options that every function of the platform takes. */
  readonly base: PlatformOptions;
  /** The URLs of the endpoints, which the administrator of the tool registers with it. */
  readonly endpoints: ReturnType<typeof platformEndpoints>;
  /** The tool as the platform registered it. */
  readonly registration: ToolRegistration;
  /** Records an identifier and says whether it was new: hints and assertions are accepted once. */
  readonly once: (id: string) => Promise<boolean>;
  /** The cache of the tool's key sets, which never fetches because the tool gave its key. */
  readonly jwks: JwksCache;
}

/** Configures a platform with the keys it generates and the one tool that it launches. */
export async function setupPlatform(clock: Clock, side: ToolSide): Promise<PlatformSetup> {
  const config: PlatformConfig = {
    issuer: ISSUER,
    origin: ISSUER,
    frameOrigin: FRAME_ORIGIN,
    reservedOrigins: [],
    keys: await generateSigningKeys(),
    hintKey: await generateHintKey(),
  };
  const registration: ToolRegistration = {
    clientId: side.clientId,
    deploymentId: side.deploymentId,
    loginUrl: side.loginUrl,
    redirectUris: [side.redirectUri],
    keys: new Map([[side.keyId, side.publicKey]]),
  };
  // The ledger of single-use identifiers: hints and assertions are accepted once.
  const used = new Set<string>();
  const once = async (id: string): Promise<boolean> => {
    if (used.has(id)) return false;
    used.add(id);
    return true;
  };
  return {
    base: { config, clock },
    endpoints: platformEndpoints(config),
    registration,
    once,
    // The tool gave its key, so the platform never fetches a key set of the tool.
    jwks: createJwksCache({ fetch: () => Promise.reject(new Error("The tool gave its key.")) }),
  };
}
