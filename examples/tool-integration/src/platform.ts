import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import {
  type AgsScore,
  agsLineItem,
  agsScores,
  ltiPlatformAuthorize,
  ltiPlatformFrame,
  type PlatformFrame,
  type platformEndpoints,
  platformJwks,
  platformToken,
  type ToolLaunch,
} from "@interopkit/tool-integration/platform";
import type { Handler } from "./network.ts";
import { ISSUER, type PlatformSetup } from "./platform-setup.ts";

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

/** Creates the platform that a setup configures. */
export function createPlatform({ base, endpoints, registration, once, jwks }: PlatformSetup): Platform {
  const scores: ReceivedScore[] = [];
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
    origin: ISSUER,
    endpoints,
    handle,
    frame: (launch) =>
      ltiPlatformFrame(launch, { ...base, registration: async () => registration, check: async () => undefined }),
    scores,
  };
}
