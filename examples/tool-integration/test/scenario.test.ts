import { describe, expect, it } from "vitest";
import { runScenario } from "../scenario.ts";

describe("the scenario", () => {
  it("launches the tool from the platform with the message that the platform kept", async () => {
    const { login, launch } = await runScenario();
    expect(login).toStrictEqual({ toolHost: "tool.example", storageUrl: "https://lms.example/storage" });
    expect(launch).toStrictEqual({
      messageType: "LtiResourceLinkRequest",
      subject: "candidate-7",
      title: "Drawing tool",
      custom: { exam: "tryout-1", user: "candidate-7" },
    });
  });

  it("answers the same authentication request a second time with the authentication error response", async () => {
    expect((await runScenario()).replay).toStrictEqual({ status: 403, error: "login_required" });
  });
});
