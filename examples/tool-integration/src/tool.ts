import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import type { LtiMessage } from "@interopkit/tool-integration";
import { type AgsScoreInput, ltiLaunch, ltiLogin, publishAgsScore } from "@interopkit/tool-integration/tool";
import type { Handler } from "./network.ts";
import { LAUNCH_PATH, LOGIN_PATH, type ToolSetup } from "./tool-setup.ts";

/** The tool: the handler of its origin, and the call that publishes a score. */
export interface Tool {
  /** The launches that the tool accepted, in order. A real tool keeps one in the user's session. */
  readonly launches: readonly LtiMessage[];
  /** Answers the requests to the tool's login URL and launch URL. */
  readonly handle: Handler;
  /** Publishes a score to the line item of a launch. */
  publish(score: AgsScoreInput, launch: LtiMessage): Promise<void>;
}

/** Creates the tool that a setup configures. */
export function createTool({ options }: ToolSetup): Tool {
  const launches: LtiMessage[] = [];
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
function launchSummary(launch: LtiMessage): Record<string, unknown> {
  return launch.messageType === "LtiResourceLinkRequest"
    ? {
        messageType: launch.messageType,
        subject: launch.user.subject,
        title: launch.resourceLink.title,
        custom: Object.fromEntries(launch.custom),
        ags: lineItemShape(launch.services.grades),
      }
    : { messageType: launch.messageType };
}

/** The scopes of the grade services and the shape of the line item URL, whose identifier is signed and differs for each launch. */
function lineItemShape(
  grades: { readonly scopes: readonly string[]; readonly lineitem?: string } | undefined,
): unknown {
  return grades && { scopes: grades.scopes, lineitem: grades.lineitem?.replace(/\/ags\/.*$/u, "/ags/{line item}") };
}
