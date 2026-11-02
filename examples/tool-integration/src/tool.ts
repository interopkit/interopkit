import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import {
  type ControlStatus,
  type DeepLinkingRequestMessage,
  type LtiMessage,
  type Result,
  SCOPES,
  type StartProctoringMessage,
} from "@interopkit/tool-integration";
import {
  advanceScoreTimestamp,
  createDeepLinkResponse,
  createServiceClient,
  createStartAssessmentPage,
  ltiLaunch,
  ltiLogin,
} from "@interopkit/tool-integration/tool";
import type { Handler } from "./network.ts";
import { LAUNCH_PATH, LOGIN_PATH, type ToolSetup } from "./tool-setup.ts";

/** What the tool saw of the gradebook when it graded a launch. */
interface Graded {
  /** The label of the line item of the launch. */
  readonly label: string;
  /** The results of the line item, after the score. */
  readonly results: readonly Result[];
}

/** What the tool saw of the course when it read its roster. */
interface Roster {
  /** The label of the course. */
  readonly course: string | undefined;
  /** Each member with the names of the groups they are in. */
  readonly members: readonly {
    readonly userId: string;
    readonly roles: readonly string[];
    readonly groups: readonly string[];
  }[];
  /** The names of the groups of the course and of its group sets. */
  readonly groups: readonly string[];
  readonly sets: readonly string[];
  /** The record of needs of the user of the launch for its activity, as the platform shares it. */
  readonly needs: Readonly<Record<string, unknown>> | undefined;
}

/** What the tool saw when it showed the work of a user to a reviewer. */
interface Review {
  /** The user whose work is shown. */
  readonly userId: string;
  /** The label of the line item that the work was graded in. */
  readonly label: string;
  /** The score that the platform has for the user, as the reviewer sees it next to the work. */
  readonly resultScore: number | undefined;
}

/** The tool: the handler of its origin, and the grading of a launch. */
export interface Tool {
  /** The launches that the tool accepted, in order. A real tool keeps one in the user's session. */
  readonly launches: readonly LtiMessage[];
  /** Answers the requests to the tool's login URL and launch URL. */
  readonly handle: Handler;
  /** Reads the line item of a launch, publishes the score of its user, and reads the results of the line item back. */
  grade(launch: LtiMessage, scoreGiven: number): Promise<Graded>;
  /** Reads the members of the course of a launch with their groups, the groups and group sets, and the record of needs of its user. */
  readRoster(launch: LtiMessage): Promise<Roster>;
  /** Pauses the attempt of a Start Proctoring message through the Assessment Control Service, as a proctor who sees an incident. */
  pause(launch: LtiMessage): Promise<ControlStatus>;
  /** Reads the line item of a Submission Review request and the result of the user whose work it shows. */
  review(launch: LtiMessage): Promise<Review>;
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
    if (launch.messageType === "LtiDeepLinkingRequest") return chooseContent(launch);
    if (launch.messageType === "LtiStartProctoring") return proctor(launch);
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(launchSummary(launch)),
    };
  };
  // A real tool shows its content and lets the user choose; here the user picks the second tryout. The answer is a page that
  // posts the signed response to the platform's return URL.
  const chooseContent = (launch: DeepLinkingRequestMessage): Promise<HttpResponse> =>
    createDeepLinkResponse(
      launch,
      {
        items: [
          {
            type: "ltiResourceLink",
            title: "Drawing tryout 2",
            url: new URL(LAUNCH_PATH, launch.targetLinkUri).href,
            custom: new Map([["exam", "tryout-2"]]),
            lineItem: { scoreMaximum: 20, label: "Drawing tryout 2", resourceId: "tryout-2" },
          },
        ],
        message: "The tryout is placed in the course.",
      },
      options,
    );
  // A real proctoring tool checks the room and the candidate first; here it verified the name against an identity document and
  // sends the candidate back to start. The answer is a page that posts the signed message to the start assessment URL.
  const proctor = (launch: StartProctoringMessage): Promise<HttpResponse> =>
    createStartAssessmentPage(
      launch,
      { verifiedUser: launch.user.name === undefined ? {} : { name: launch.user.name } },
      options,
    );
  const pause = async (launch: LtiMessage): Promise<ControlStatus> => {
    const subject = launch.user.subject;
    if (
      launch.messageType !== "LtiStartProctoring" ||
      launch.assessmentControl === undefined ||
      subject === undefined
    ) {
      throw new Error("The launch offers no control of an attempt.");
    }
    // The claim of the service has no scopes: Proctoring Services fixes its one scope.
    const client = createServiceClient(launch, { ...options, scopes: [SCOPES.assessmentControl] });
    return client.control(launch.assessmentControl.url, {
      user: { issuer: launch.issuer, subject },
      resourceLink: { id: launch.resourceLink.id },
      attemptNumber: launch.attemptNumber,
      action: "pause",
      incidentSeverity: 0.8,
      reasonMessage: "A second person is in view.",
    });
  };
  const review = async (launch: LtiMessage): Promise<Review> => {
    const grades = launch.services.grades;
    if (launch.messageType !== "LtiSubmissionReviewRequest" || grades?.lineitem === undefined) {
      throw new Error("The launch is not a review of a line item.");
    }
    const { userId } = launch.forUser;
    const client = createServiceClient(launch, { ...options, scopes: grades.scopes });
    const lineItem = await client.lineItem(grades.lineitem);
    if (lineItem === undefined) throw new Error("The platform has no line item at the URL of the launch.");
    const { items } = await client.results(grades.lineitem, { userId });
    return { userId, label: lineItem.label, resultScore: items[0]?.resultScore };
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
  const readRoster = async (launch: LtiMessage): Promise<Roster> => {
    const { roster, groups, preferences } = launch.services;
    const activityId = launch.messageType === "LtiResourceLinkRequest" ? launch.resourceLink.id : undefined;
    const userId = launch.user.subject;
    if (roster === undefined || groups?.contextGroupSetsUrl === undefined || preferences === undefined) {
      throw new Error("The launch offers no roster.");
    }
    if (activityId === undefined || userId === undefined) throw new Error("The launch offers no activity of a user.");
    // The claim of Names and Role Provisioning has no scopes: the specification fixes its one scope.
    const scopes = [SCOPES.contextMembershipReadonly, ...groups.scopes, ...preferences.scopes];
    const client = createServiceClient(launch, { ...options, scopes });
    const members = await client.members(roster.contextMembershipsUrl, { groups: true });
    const names = new Map((await client.groups(groups.contextGroupsUrl)).items.map((group) => [group.id, group.name]));
    return {
      course: members.context.label ?? members.context.title,
      members: members.items.map((member) => ({
        userId: member.userId,
        roles: member.roles,
        groups: (member.groupEnrollments ?? []).map(({ groupId }) => names.get(groupId) ?? groupId),
      })),
      groups: [...names.values()],
      sets: (await client.groupSets(groups.contextGroupSetsUrl)).items.map((set) => set.name),
      needs: await client.preferences(preferences, userId, activityId),
    };
  };
  return { launches, handle, grade, readRoster, pause, review };
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
    : {
        messageType: launch.messageType,
        ...(launch.messageType === "LtiSubmissionReviewRequest" ? { forUser: launch.forUser.userId } : {}),
        ...(launch.messageType === "LtiEndAssessment" ? { attemptNumber: launch.attemptNumber } : {}),
      };
}
