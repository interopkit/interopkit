import type { Clock } from "@interopkit/core";
import { createJwksCache, SCOPES } from "@interopkit/tool-integration";
import {
  buildPlatformEndpoints,
  type LaunchStore,
  type MessageInput,
  type PlatformConfig,
  type PlatformEndpoints,
  type PlatformLoginOptions,
  type PlatformRequestOptions,
  type ToolRegistration,
} from "@interopkit/tool-integration/platform";
import { createGradebook, type Gradebook } from "./gradebook.ts";
import { generateHintKey, generatePlatformKeys } from "./keys.ts";

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

/** What the platform is configured with: the options of its login and of its handler, and its endpoints. */
export interface PlatformSetup {
  /** The options of `ltiPlatformFrame`. */
  readonly login: PlatformLoginOptions;
  /** The options of `handlePlatformRequest`. */
  readonly requests: PlatformRequestOptions;
  /** The URLs of the endpoints, which the administrator of the tool registers with it. */
  readonly endpoints: PlatformEndpoints;
  /** The gradebook behind the grade services. */
  readonly gradebook: Gradebook;
}

/** The launches in progress, in memory: a real host keeps them where every process can reach them, for 300 seconds. */
function launchStore(): LaunchStore {
  const kept = new Map<string, MessageInput>();
  return {
    put: async (id, message) => void kept.set(id, message),
    take: async (id) => {
      const message = kept.get(id);
      kept.delete(id);
      return message;
    },
  };
}

/** Configures a platform with the keys it generates and the one tool that it launches. */
export async function setupPlatform(clock: Clock, side: ToolSide): Promise<PlatformSetup> {
  const config: PlatformConfig = {
    issuer: ISSUER,
    origin: ISSUER,
    frameOrigin: FRAME_ORIGIN,
    reservedOrigins: [],
    keys: await generatePlatformKeys("platform-1"),
    hintKey: await generateHintKey(),
  };
  const registration: ToolRegistration = {
    clientId: side.clientId,
    deploymentIds: [side.deploymentId],
    loginUrl: side.loginUrl,
    redirectUris: [side.redirectUri],
    keys: new Map([[side.keyId, side.publicKey]]),
    // The tool may read the line items and the results, and post scores; it may not change the line items.
    scopes: [SCOPES.lineitemReadonly, SCOPES.resultReadonly, SCOPES.score],
  };
  const tools = async (clientId: string) => (clientId === registration.clientId ? registration : undefined);
  // The ledger of single-use identifiers: a client assertion is accepted once.
  const used = new Set<string>();
  const once = async (id: string): Promise<boolean> => {
    if (used.has(id)) return false;
    used.add(id);
    return true;
  };
  const launches = launchStore();
  const gradebook = createGradebook();
  return {
    login: { config, clock, registration: tools, check: async () => undefined, launches },
    requests: {
      config,
      clock,
      client: tools,
      launches,
      once,
      // The tool gave its key, so the platform never fetches a key set of the tool.
      jwks: createJwksCache({ fetch: () => Promise.reject(new Error("The tool gave its key.")) }),
      services: { gradebook: gradebook.store },
    },
    endpoints: buildPlatformEndpoints(config),
    gradebook,
  };
}
