import type { Clock, Fetch } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import {
  type KeySet,
  type PlatformConfiguration,
  SCOPES,
  type ToolRegistrationResult,
} from "@interopkit/tool-integration";
import {
  buildPlatformRegistration,
  buildRegistrationClosePage,
  createServiceClient,
  discoverPlatform,
  type PlatformRegistration,
  readRegistrationInitiation,
  registerTool,
  serveToolJwks,
} from "@interopkit/tool-integration/tool";
import type { Handler } from "./network.ts";

/** The paths of the tool that registers itself: its initiation URL, its key set, its login and its launch. */
const REGISTER_PATH = "/lti/register";
const JWKS_PATH = "/.well-known/jwks.json";

/** A tool that registers itself with a platform through Dynamic Registration, and what it learned of the platform. */
export interface RegisteringTool {
  readonly origin: string;
  /** The tool's initiation URL, which its administrator gives the platform's administrator. */
  readonly initiationUrl: string;
  /** Answers the requests to the tool's routes. */
  readonly handle: Handler;
  /** The platform's configuration and the registration it recorded, once the tool registered. */
  readonly registered: { platform?: PlatformConfiguration; result?: ToolRegistrationResult };
  /** Makes the tool's record of the platform, once the platform's administrator activated the tool with a deployment. */
  activate(deploymentId: string): PlatformRegistration;
  /** Reads the registration back from the platform with a token of `registration.readonly`. */
  readRegistration(record: PlatformRegistration, deploymentId: string): Promise<ToolRegistrationResult>;
}

/**
 * Creates a tool that registers itself: its initiation route discovers the platform, registers and answers with the page that
 * tells the platform's window to close; its key set route serves the key with which the platform verifies its tokens. A real tool
 * puts the initiation route behind the session of its administrator, and may show its own pages between the steps.
 */
export function createRegisteringTool(origin: string, keys: KeySet, fetch: Fetch, clock: Clock): RegisteringTool {
  const registered: RegisteringTool["registered"] = {};
  const register = async (request: Parameters<Handler>[0]): Promise<HttpResponse> => {
    const initiation = readRegistrationInitiation(request);
    const platform = await discoverPlatform(initiation, { fetch });
    const result = await registerTool(
      platform,
      {
        initiateLoginUri: `${origin}/lti/login`,
        redirectUris: [`${origin}/lti/launch`],
        clientName: "Quiz tool",
        jwksUri: `${origin}${JWKS_PATH}`,
        scope: `${SCOPES.registrationReadonly} ${SCOPES.score}`,
        lti: {
          domain: new URL(origin).host,
          targetLinkUri: `${origin}/lti/launch`,
          messages: [{ type: "LtiDeepLinkingRequest", placements: ["ContentArea"] }],
          claims: ["iss", "sub", "name"],
        },
      },
      initiation,
      { fetch },
    );
    Object.assign(registered, { platform, result });
    return buildRegistrationClosePage();
  };
  const handle: Handler = async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === REGISTER_PATH) return register(request);
    if (pathname === JWKS_PATH) return serveToolJwks(request, keys);
    return { status: 404, headers: {}, body: "" };
  };
  return {
    origin,
    initiationUrl: `${origin}${REGISTER_PATH}`,
    handle,
    registered,
    activate(deploymentId) {
      const { platform, result } = registered;
      if (platform === undefined || result === undefined) throw new Error("The tool has not registered.");
      return buildPlatformRegistration(platform, result, {
        signer: keys.signer,
        redirectUri: `${origin}/lti/launch`,
        deploymentIds: [deploymentId],
      });
    },
    readRegistration(record, deploymentId) {
      const { result } = registered;
      if (result === undefined) throw new Error("The tool has not registered.");
      const client = createServiceClient(
        { issuer: record.issuer, clientId: record.clientId, deploymentId },
        { registration: async () => record, clock, fetch, scopes: [SCOPES.registrationReadonly] },
      );
      return client.getToolRegistration(result);
    },
  };
}
