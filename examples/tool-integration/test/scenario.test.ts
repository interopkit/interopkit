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

  it("answers the same authentication request a second time with the authentication error response", async () => {
    expect((await runScenario()).replay).toStrictEqual({ status: 403, error: "login_required" });
  });
});
