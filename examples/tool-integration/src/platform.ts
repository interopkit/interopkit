import { LtiError } from "@interopkit/tool-integration";
import {
  handlePlatformRequest,
  ltiPlatformFrame,
  type MessageInput,
  type PlatformEndpoints,
  type PlatformFrame,
  type ReceivedDeepLinkingResponse,
  readDeepLinkingResponse,
} from "@interopkit/tool-integration/platform";
import type { Gradebook } from "./gradebook.ts";
import type { Handler } from "./network.ts";
import { DEEP_LINKING_PATH, ISSUER, type PlatformSetup } from "./platform-setup.ts";

/** The platform: the handler of its origin, and the launches it prepares. */
export interface Platform {
  readonly issuer: string;
  readonly origin: string;
  /** The URLs of the endpoints, which the administrator of the tool registers with it. */
  readonly endpoints: PlatformEndpoints;
  /** Answers the requests to the platform's origin. */
  readonly handle: Handler;
  /** Keeps a message for the tool and returns what the page that shows the tool needs. */
  frame(message: MessageInput): Promise<PlatformFrame>;
  /** The gradebook behind the grade services. */
  readonly gradebook: Gradebook;
  /** The responses to Deep Linking requests that the platform accepted, in order. A real host acts on them: it places the items. */
  readonly deepLinked: readonly ReceivedDeepLinkingResponse[];
}

/** Creates the platform that a setup configures: one handler serves every route of its origin. */
export function createPlatform({ login, requests, toolMessage, endpoints, gradebook }: PlatformSetup): Platform {
  const deepLinked: ReceivedDeepLinkingResponse[] = [];
  // The route at the `deep_link_return_url` of a request is the host's own: the library reads the form that the tool posts.
  const answerDeepLinking: Handler = async (request) => {
    try {
      deepLinked.push(await readDeepLinkingResponse(request, toolMessage));
      return { status: 200, headers: { "content-type": "text/plain" }, body: "The items are placed." };
    } catch (error) {
      if (error instanceof LtiError) {
        return { status: error.status, headers: { "content-type": "text/plain" }, body: error.message };
      }
      throw error;
    }
  };
  return {
    issuer: ISSUER,
    origin: ISSUER,
    endpoints,
    handle: (request) =>
      new URL(request.url).pathname === DEEP_LINKING_PATH
        ? answerDeepLinking(request)
        : handlePlatformRequest(request, requests),
    frame: (message) => ltiPlatformFrame(message, login),
    gradebook,
    deepLinked,
  };
}
