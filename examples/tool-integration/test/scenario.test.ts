import { describe, expect, it } from "vitest";
import { runScenario } from "../scenario.ts";

const LINE_ITEM = "https://lms.example/contexts/course-1/line-items/quiz-1";

describe("the scenario", () => {
  it("launches the tool from the platform with the message that the platform kept and the grade services it offers", async () => {
    const { login, launch } = await runScenario();
    expect(login).toStrictEqual({ toolHost: "tool.example", storageUrl: "https://lms.example/storage" });
    expect(launch).toStrictEqual({
      messageType: "LtiResourceLinkRequest",
      subject: "candidate-7",
      title: "Drawing tool",
      custom: { exam: "tryout-1", user: "candidate-7", lineItem: LINE_ITEM },
      ags: {
        scopes: [
          "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
          "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
          "https://purl.imsglobal.org/spec/lti-ags/scope/score",
        ],
        lineitem: LINE_ITEM,
      },
    });
  });

  it("keeps the score that the tool publishes, and gives the tool its result", async () => {
    const { graded, kept } = await runScenario();
    expect(kept).toStrictEqual([
      { lineItemId: "quiz-1", userId: "candidate-7", scoreGiven: 8, timestamp: "2023-11-14T22:13:20.000Z" },
    ]);
    expect(graded).toStrictEqual({
      label: "Drawing quiz",
      results: [
        {
          id: `${LINE_ITEM}/results?user_id=candidate-7`,
          scoreOf: LINE_ITEM,
          userId: "candidate-7",
          resultScore: 8,
          resultMaximum: 10,
          scoringUserId: undefined,
          comment: undefined,
          extensions: undefined,
        },
      ],
    });
  });

  it("reads the members of the course with their groups, the groups and sets, and the record of needs of the user", async () => {
    const { roster } = await runScenario();
    expect(roster).toStrictEqual({
      course: "DRAW 101",
      members: [
        { userId: "instructor-1", roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"], groups: [] },
        {
          userId: "candidate-7",
          roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
          groups: ["Drawing group A"],
        },
        { userId: "candidate-8", roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"], groups: [] },
      ],
      groups: ["Drawing group A"],
      sets: ["Drawing lab"],
      needs: { "additional-testing-time": { "time-factor": 1.5 } },
    });
  });

  it("places the content that the tool chose, which the platform reads with the data that it sealed into the request", async () => {
    const { deepLinked } = await runScenario();
    expect(deepLinked).toStrictEqual({
      posted: { to: "https://lms.example/deep-linking", fields: ["JWT"] },
      status: 200,
      data: { placement: "week-3" },
      message: "The tryout is placed in the course.",
      items: [
        {
          type: "ltiResourceLink",
          title: "Drawing tryout 2",
          url: "https://tool.example/lti/launch",
          custom: { exam: "tryout-2" },
          lineItem: { scoreMaximum: 20, label: "Drawing tryout 2", resourceId: "tryout-2" },
        },
      ],
    });
  });

  it("starts the proctored attempt that the proctoring tool sends back, which the tool then pauses as a proctor", async () => {
    const { proctored } = await runScenario();
    expect(proctored).toStrictEqual({
      posted: { to: "https://lms.example/proctoring/start", fields: ["JWT"] },
      status: 200,
      subject: "candidate-7",
      attemptNumber: 1,
      verifiedName: "Ana Candidate",
      paused: "paused",
      kept: { status: "paused" },
    });
  });

  it("shows the work of a user to a reviewer with the line item and the result that the platform holds", async () => {
    const { reviewed } = await runScenario();
    expect(reviewed).toStrictEqual({
      launch: { messageType: "LtiSubmissionReviewRequest", forUser: "candidate-7" },
      userId: "candidate-7",
      label: "Drawing quiz",
      resultScore: 8,
    });
  });

  it("sends the candidate to the proctoring tool with the message that ends the attempt", async () => {
    expect((await runScenario()).ended).toStrictEqual({ messageType: "LtiEndAssessment", attemptNumber: 1 });
  });

  it("registers a second tool through Dynamic Registration, which reads its registration back once both sides activated it", async () => {
    const { registered } = await runScenario();
    expect(registered).toStrictEqual({
      closes: true,
      clientId: "registered-tool-1",
      scope:
        "https://purl.imsglobal.org/spec/lti-reg/scope/registration.readonly https://purl.imsglobal.org/spec/lti-ags/scope/score",
      registrationClientUri: "https://lms.example/registration/registered-tool-1",
      platform: {
        issuer: "https://lms.example",
        authenticationUrl: "https://lms.example/authorize",
        accessTokenUrl: "https://lms.example/token",
        jwksUrl: "https://lms.example/jwks",
        deploymentIds: ["deployment-quiz-1"],
      },
      readBack: { clientId: "registered-tool-1", clientName: "Quiz tool" },
    });
  });

  it("answers the same authentication request a second time with the authentication error response", async () => {
    expect((await runScenario()).replay).toStrictEqual({ status: 403, error: "login_required" });
  });
});
