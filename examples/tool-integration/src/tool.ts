import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import type { LtiMessage, Result } from "@interopkit/tool-integration";
import { advanceScoreTimestamp, createServiceClient, ltiLaunch, ltiLogin } from "@interopkit/tool-integration/tool";
import type { Handler } from "./network.ts";
import { LAUNCH_PATH, LOGIN_PATH, type ToolSetup } from "./tool-setup.ts";

/** What the tool saw of the gradebook when it graded a launch. */
interface Graded {
  /** The label of the line item of the launch. */
  readonly label: string;
  /** The results of the line item, after the score. */
  readonly results: readonly Result[];
}

/** The tool: the handler of its origin, and the grading of a launch. */
export interface Tool {
  /** The launches that the tool accepted, in order. A real tool keeps one in the user's session. */
  readonly launches: readonly LtiMessage[];
  /** Answers the requests to the tool's login URL and launch URL. */
  readonly handle: Handler;
  /** Reads the line item of a launch, publishes the score of its user, and reads the results of the line item back. */
  grade(launch: LtiMessage, scoreGiven: number): Promise<Graded>;
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
  const grade = async (launch: LtiMessage, scoreGiven: number): Promise<Graded> => {
    const grades = launch.services.grades;
    const userId = launch.user.subject;
    if (grades?.lineitem === undefined || userId === undefined)
      throw new Error("The launch offers no line item of a user.");
    // A real tool keeps one client for each deployment, so that its tokens are reused.
    const client = createServiceClient(launch, { ...options, scopes: grades.scopes });
    const lineItem = await client.lineItem(grades.lineitem);
    if (lineItem === undefined) throw new Error("The platform has no line item at the URL of the launch.");
    await client.publishScore(grades.lineitem, {
      userId,
      scoreGiven,
      scoreMaximum: lineItem.scoreMaximum,
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
      // Each score of a line item and a user needs a strictly later timestamp; this is the first.
      timestamp: advanceScoreTimestamp(undefined, options.clock.now()),
    });
    const { items } = await client.results(grades.lineitem);
    return { label: lineItem.label, results: items };
  };
  return { launches, handle, grade };
}

/** What the route of the launch tells the browser: enough for the scenario to check the launch, and nothing secret. */
function launchSummary(launch: LtiMessage): Record<string, unknown> {
  return launch.messageType === "LtiResourceLinkRequest"
    ? {
        messageType: launch.messageType,
        subject: launch.user.subject,
        title: launch.resourceLink.title,
        custom: Object.fromEntries(launch.custom),
        ags: launch.services.grades,
      }
    : { messageType: launch.messageType };
}
