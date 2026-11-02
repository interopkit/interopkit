import { LtiError } from "@interopkit/tool-integration";
import {
  handlePlatformRequest,
  ltiPlatformFrame,
  type MessageInput,
  type PlatformEndpoints,
  type PlatformFrame,
  type ReceivedDeepLinkingResponse,
  type ReceivedStartAssessment,
  readDeepLinkingResponse,
  readStartAssessment,
} from "@interopkit/tool-integration/platform";
import type { Gradebook } from "./gradebook.ts";
import type { Handler } from "./network.ts";
import { DEEP_LINKING_PATH, ISSUER, type PlatformSetup, START_ASSESSMENT_PATH } from "./platform-setup.ts";
import type { Attempts } from "./proctoring.ts";

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
  /** The attempts of proctored assessments behind the Assessment Control Service. */
  readonly attempts: Attempts;
  /** The Start Assessment messages that the platform accepted, in order: each started an attempt. */
  readonly started: readonly ReceivedStartAssessment[];
}

/** Answers a route of the host with text, or with the status of a refusal of the library. */
async function answerWith(read: () => Promise<string>): Promise<Awaited<ReturnType<Handler>>> {
  try {
    return { status: 200, headers: { "content-type": "text/plain" }, body: await read() };
  } catch (error) {
    if (error instanceof LtiError) {
      return { status: error.status, headers: { "content-type": "text/plain" }, body: error.message };
    }
    throw error;
  }
}

/** Creates the platform that a setup configures: one handler serves every route of its origin. */
export function createPlatform(setup: PlatformSetup): Platform {
  const { login, requests, toolMessage, endpoints, gradebook, attempts } = setup;
  const deepLinked: ReceivedDeepLinkingResponse[] = [];
  const started: ReceivedStartAssessment[] = [];
  // The routes at the `deep_link_return_url` of a request and at the `start_assessment_url` of a Start Proctoring message are the
  // host's own: the library reads the form that the tool posts.
  const routes: Readonly<Record<string, Handler>> = {
    [DEEP_LINKING_PATH]: (request) =>
      answerWith(async () => {
        deepLinked.push(await readDeepLinkingResponse(request, toolMessage));
        return "The items are placed.";
      }),
    [START_ASSESSMENT_PATH]: (request) =>
      answerWith(async () => {
        const message = await readStartAssessment(request, toolMessage);
        // A real host starts the attempt only when its own session of the browser is of the subject that the session data binds.
        if (message.subject === undefined) throw new Error("The example proctors only known candidates.");
        attempts.start(message.clientId, message.subject, message.resourceLink.id, message.attemptNumber);
        started.push(message);
        return "The assessment starts.";
      }),
  };
  return {
    issuer: ISSUER,
    origin: ISSUER,
    endpoints,
    handle: (request) =>
      (routes[new URL(request.url).pathname] ?? ((sent) => handlePlatformRequest(sent, requests)))(request),
    frame: (message) => ltiPlatformFrame(message, login),
    gradebook,
    deepLinked,
    attempts,
    started,
  };
}
