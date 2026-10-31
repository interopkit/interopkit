import { describe, expect, it } from "vitest";
import { runScenario } from "../scenario.ts";

describe("the scenario", () => {
  it("launches the tool from the platform and gives the tool the grade services of the launch", async () => {
    const { login, launch } = await runScenario();
    expect(login).toStrictEqual({ toolHost: "tool.example", storageUrl: "https://lms.example/storage" });
    expect(launch).toStrictEqual({
      messageType: "LtiResourceLinkRequest",
      subject: "candidate-7",
      title: "Drawing tool",
      ags: {
        scopes: [
          "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
          "https://purl.imsglobal.org/spec/lti-ags/scope/score",
        ],
        lineitem: "https://lms.example/ags/{line item}",
      },
    });
  });

  it("receives the score that the tool publishes, for the resource of the launch and the user of it", async () => {
    const { scores } = await runScenario();
    expect(scores).toStrictEqual([
      {
        resource: "session-1/question-4/1",
        userId: "candidate-7",
        scoreGiven: 8,
        scoreMaximum: 10,
        gradingProgress: "FullyGraded",
      },
    ]);
  });

  it("refuses the same authentication request a second time", async () => {
    expect((await runScenario()).replay).toBe("hint-used");
  });
});
