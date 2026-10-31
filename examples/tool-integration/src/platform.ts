import type { Clock } from "@interopkit/core";
import { createJwksCache, type HttpRequest, type HttpResponse } from "@interopkit/tool-integration";
import {
  type AgsScore,
  agsLineItem,
  agsScores,
  ltiPlatformAuthorize,
  ltiPlatformFrame,
  type PlatformConfig,
  type PlatformFrame,
  type PlatformOptions,
  platformEndpoints,
  platformJwks,
  platformToken,
  type ToolLaunch,
  type ToolRegistration,
} from "@interopkit/tool-integration/platform";
import { generateHintKey, generateSigningKeys } from "./keys.ts";
import type { Handler } from "./network.ts";

/** A score that the tool posted, with the resource of the launch it belongs to. */
interface ReceivedScore {
  readonly resource: string;
  readonly score: AgsScore;
}

/** The platform: the handler of its origin, the launches it prepares, and the scores it received. */
export interface Platform {
  readonly issuer: string;
  readonly origin: string;
  /** The URLs of the endpoints, which the administrator of the tool registers with it. */
  readonly endpoints: ReturnType<typeof platformEndpoints>;
  /** Answers the requests to the platform's origin. */
  readonly handle: Handler;
  /** Prepares the launch of the tool for a resource and returns what the page that shows it needs. */
  frame(launch: ToolLaunch): Promise<PlatformFrame>;
  /** The scores that the tool posted, in order. */
  readonly scores: readonly ReceivedScore[];
}

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

const ISSUER = "https://lms.example";
const ORIGIN = ISSUER;
const FRAME_ORIGIN = "https://app.lms.example";

/** Creates a platform with the keys it generates and the one tool that it launches. */
export async function createPlatform(clock: Clock, side: ToolSide): Promise<Platform> {
  const config: PlatformConfig = {
    issuer: ISSUER,
    origin: ORIGIN,
    frameOrigin: FRAME_ORIGIN,
    reservedOrigins: [],
    keys: await generateSigningKeys(),
    hintKey: await generateHintKey(),
  };
  const endpoints = platformEndpoints(config);
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
  const scores: ReceivedScore[] = [];
  const base: PlatformOptions = { config, clock };
  // The tool gave its key, so the platform never fetches a key set of the tool.
  const jwks = createJwksCache({ fetch: () => Promise.reject(new Error("The tool gave its key.")) });
  const handle: Handler = (request: HttpRequest): Promise<HttpResponse> => {
    const { pathname } = new URL(request.url);
    if (pathname === "/authorize") {
      return ltiPlatformAuthorize(request, { ...base, client: async () => registration, once });
    }
    if (pathname === "/jwks") return platformJwks(base);
    if (pathname === "/token") return platformToken(request, { ...base, client: async () => registration, jwks, once });
    if (pathname.startsWith("/ags/") && pathname.endsWith("/scores")) {
      return agsScores(request, {
        ...base,
        onScore: async (resource, score) => {
          scores.push({ resource, score });
        },
      });
    }
    return agsLineItem(request, base);
  };
  return {
    issuer: ISSUER,
    origin: ORIGIN,
    endpoints,
    handle,
    frame: (launch) =>
      ltiPlatformFrame(launch, { ...base, registration: async () => registration, check: async () => undefined }),
    scores,
  };
}
