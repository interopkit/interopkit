import {
  handlePlatformRequest,
  ltiPlatformFrame,
  type MessageInput,
  type PlatformEndpoints,
  type PlatformFrame,
} from "@interopkit/tool-integration/platform";
import type { Gradebook } from "./gradebook.ts";
import type { Handler } from "./network.ts";
import { ISSUER, type PlatformSetup } from "./platform-setup.ts";

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
}

/** Creates the platform that a setup configures: one handler serves every route of its origin. */
export function createPlatform({ login, requests, endpoints, gradebook }: PlatformSetup): Platform {
  return {
    issuer: ISSUER,
    origin: ISSUER,
    endpoints,
    handle: (request) => handlePlatformRequest(request, requests),
    frame: (message) => ltiPlatformFrame(message, login),
    gradebook,
  };
}
