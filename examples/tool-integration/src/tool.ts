import type { Clock, Fetch } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import { createJwksCache } from "@interopkit/tool-integration";
import {
  type AgsScoreInput,
  type LoginRecord,
  type LtiLaunch,
  ltiLaunch,
  ltiLogin,
  type PlatformRegistration,
  publishAgsScore,
} from "@interopkit/tool-integration/tool";
import type { Handler } from "./network.ts";

/** The tool: the handler of its origin, and the call that publishes a score. */
export interface Tool {
  /** The launches that the tool accepted, in order. A real tool keeps one in the user's session. */
  readonly launches: readonly LtiLaunch[];
  /** Answers the requests to the tool's login URL and launch URL. */
  readonly handle: Handler;
  /** Publishes a score to the line item of a launch. */
  publish(score: AgsScoreInput, launch: LtiLaunch): Promise<void>;
}

/** The platform as the tool's administrator registered it. */
export interface PlatformSide {
  readonly issuer: string;
  readonly clientId: string;
  readonly deploymentId: string;
  readonly authenticationUrl: string;
  readonly jwksUrl: string;
  readonly accessTokenUrl: string;
}

const LOGIN_PATH = "/lti/login";
const LAUNCH_PATH = "/lti/launch";

/** Creates a tool that trusts one platform. */
export function createTool(
  clock: Clock,
  fetch: Fetch,
  origin: string,
  platform: PlatformSide,
  keys: { readonly keyId: string; readonly signingKey: CryptoKey },
): Tool {
  const registration: PlatformRegistration = {
    issuer: platform.issuer,
    clientId: platform.clientId,
    deploymentIds: [platform.deploymentId],
    authenticationUrl: platform.authenticationUrl,
    jwksUrl: platform.jwksUrl,
    accessTokenUrl: platform.accessTokenUrl,
    redirectUri: `${origin}${LAUNCH_PATH}`,
    keyId: keys.keyId,
    signingKey: keys.signingKey,
  };
  // The tool keeps the logins in progress in memory; a real tool keeps them where every process can reach them.
  const logins = new Map<string, LoginRecord>();
  const store = {
    put: async (state: string, record: LoginRecord) => void logins.set(state, record),
    get: async (state: string) => logins.get(state),
    delete: async (state: string) => logins.delete(state),
  };
  const launches: LtiLaunch[] = [];
  const options = {
    registration: async () => registration,
    clock,
    store,
    jwks: createJwksCache({ fetch }),
    fetch,
  };
  const handle: Handler = async (request: HttpRequest): Promise<HttpResponse> => {
    const { pathname } = new URL(request.url);
    if (pathname === LOGIN_PATH) return ltiLogin(request, options);
    if (pathname !== LAUNCH_PATH) return { status: 404, headers: {}, body: "" };
    const launch = await ltiLaunch(request, options);
    if ("status" in launch) return launch;
    launches.push(launch);
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(launchSummary(launch)),
    };
  };
  return { launches, handle, publish: (score, launch) => publishAgsScore(score, launch, options) };
}

/** What the route of the launch tells the browser: enough for the scenario to check the launch, and nothing secret. */
function launchSummary(launch: LtiLaunch): Record<string, unknown> {
  return launch.messageType === "LtiResourceLinkRequest"
    ? {
        messageType: launch.messageType,
        subject: launch.subject,
        title: launch.resourceLink.title,
        ags: lineItemShape(launch.ags),
      }
    : { messageType: launch.messageType };
}

/** The scopes of the grade services and the shape of the line item URL, whose identifier is signed and differs for each launch. */
function lineItemShape(ags: Extract<LtiLaunch, { messageType: "LtiResourceLinkRequest" }>["ags"]): unknown {
  return ags && { scopes: ags.scopes, lineitem: ags.lineitem?.replace(/\/ags\/.*$/u, "/ags/{line item}") };
}
