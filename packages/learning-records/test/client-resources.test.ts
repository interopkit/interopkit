import { DataError, ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { fakeLrs } from "./fake-lrs.js";
import { clientOf, failureOf, fromJson } from "./lrs-client.js";

const ACTIVITY = "https://example.org/activities/course-1";
const AGENT = { mbox: "mailto:learner@example.org" } as const;

describe("getActivity", () => {
  it("fetches the Activity with an id and reads it into the model", async () => {
    const activity = {
      objectType: "Activity",
      id: ACTIVITY,
      definition: { name: { "en-US": "Course 1" }, type: "http://adlnet.gov/expapi/activities/course" },
    };
    const lrs = fakeLrs(() => ({ body: activity }));
    expect(await clientOf(lrs).getActivity(ACTIVITY)).toStrictEqual(activity);
    expect(lrs.paths()).toStrictEqual([`/xapi/activities?activityId=${encodeURIComponent(ACTIVITY)}`]);
    expect(lrs.requests[0]?.init.method).toBe("GET");
  });

  it("reads an Activity with only an id, which an LRS answers for an Activity it does not describe", async () => {
    const lrs = fakeLrs(() => ({ body: { id: ACTIVITY } }));
    expect(await clientOf(lrs).getActivity(ACTIVITY)).toStrictEqual({ id: ACTIVITY });
  });

  it("refuses an Activity of another id, and takes one whose scheme and host have another case", async () => {
    const other = fakeLrs(() => ({ body: { id: "https://example.org/activities/course-2" } }));
    await expect(clientOf(other).getActivity(ACTIVITY)).rejects.toThrow(
      `answered with data that is not valid xAPI: The Activity has the id https://example.org/activities/course-2, and the request asked for ${ACTIVITY}.`,
    );
    const folded = fakeLrs(() => ({ body: { id: "HTTPS://EXAMPLE.ORG/activities/course-1" } }));
    expect(await clientOf(folded).getActivity(ACTIVITY)).toStrictEqual({
      id: "HTTPS://EXAMPLE.ORG/activities/course-1",
    });
  });

  it("rejects with a ServiceError for 404, since an LRS always answers with an Activity", async () => {
    expect(await failureOf(clientOf(fakeLrs(() => ({ status: 404 }))).getActivity(ACTIVITY))).toBeInstanceOf(
      ServiceError,
    );
  });

  it("refuses an answer that is no Activity, and an id that is no IRI, before any request", async () => {
    await expect(clientOf(fakeLrs(() => ({ body: { id: "course" } }))).getActivity(ACTIVITY)).rejects.toThrow(
      /^The LRS at .* answered with data that is not valid xAPI: The Activity is invalid at id/u,
    );
    await expect(clientOf(fakeLrs(() => ({ body: [] }))).getActivity(ACTIVITY)).rejects.toThrow(
      "The Activity is invalid",
    );
    const lrs = fakeLrs(() => ({ body: { id: ACTIVITY } }));
    await expect(clientOf(lrs).getActivity("course")).rejects.toThrow(/^The activity id is invalid/u);
    await expect(clientOf(lrs).getActivity(fromJson("5"))).rejects.toThrow(DataError);
    expect(lrs.requests).toHaveLength(0);
  });
});

describe("getPerson", () => {
  it("fetches what the LRS knows of an Agent", async () => {
    const person = {
      objectType: "Person",
      name: ["Example Learner", "E. Learner"],
      mbox: ["mailto:learner@example.org"],
      mbox_sha1sum: ["f7c1e2a8d3b9a0c4e5f6071829304a5b6c7d8e9f"],
      openid: ["https://example.org/openid/learner"],
      account: [{ homePage: "https://example.org", name: "learner-1" }],
    };
    const lrs = fakeLrs(() => ({ body: person }));
    expect(await clientOf(lrs).getPerson(AGENT)).toStrictEqual(person);
    expect(lrs.paths()).toStrictEqual([
      `/xapi/agents?agent=${encodeURIComponent(JSON.stringify(AGENT)).replace(/%20/gu, "+")}`,
    ]);
  });

  it("reads the Person of an Agent that the LRS knows nothing else of", async () => {
    const lrs = fakeLrs(() => ({ body: { objectType: "Person", mbox: [AGENT.mbox] } }));
    expect(await clientOf(lrs).getPerson(AGENT)).toStrictEqual({ objectType: "Person", mbox: [AGENT.mbox] });
  });

  it.each([
    [{ mbox: [AGENT.mbox] }, 'missing the property "objectType"'],
    [{ objectType: "Agent", mbox: [AGENT.mbox] }, "The Person is invalid at objectType"],
    [{ objectType: "Person", mbox: AGENT.mbox }, "The Person is invalid at mbox: expected an array"],
    [{ objectType: "Person", mbox: ["learner@example.org"] }, "The Person is invalid at mbox[0]"],
    [{ objectType: "Person", account: [{ name: "x" }] }, "The Person is invalid at account[0]"],
    [{ objectType: "Person", nickname: ["x"] }, 'unexpected property "nickname"'],
  ])("refuses the answer %j", async (body, sentence) => {
    await expect(clientOf(fakeLrs(() => ({ body }))).getPerson(AGENT)).rejects.toThrow(sentence);
  });

  it("refuses an Agent that has no identifier or several, before any request", async () => {
    const lrs = fakeLrs(() => ({ body: { objectType: "Person" } }));
    await expect(clientOf(lrs).getPerson({ name: "x" })).rejects.toThrow(
      /^The Agent is invalid: expected an Agent or identified Group/u,
    );
    await expect(clientOf(lrs).getPerson({ mbox: AGENT.mbox, openid: "https://example.org/a" })).rejects.toThrow(
      DataError,
    );
    expect(lrs.requests).toHaveLength(0);
  });
});

describe("about", () => {
  it("fetches the versions that the LRS speaks and its extensions", async () => {
    const about = { version: ["2.0.0", "1.0.3"], extensions: { "https://example.org/x": { feature: true } } };
    const lrs = fakeLrs(() => ({ body: about }));
    expect(await clientOf(lrs).about()).toStrictEqual(about);
    expect(lrs.paths()).toStrictEqual(["/xapi/about"]);
  });

  it("reads an answer with only the versions", async () => {
    expect(await clientOf(fakeLrs(() => ({ body: { version: ["2.0.0"] } }))).about()).toStrictEqual({
      version: ["2.0.0"],
    });
  });

  it.each([
    [{}, 'missing the property "version"'],
    [{ version: [] }, "The answer is invalid at version: expected a length of at least 1"],
    [{ version: "2.0.0" }, "The answer is invalid at version: expected an array"],
    [{ version: [2] }, "The answer is invalid at version[0]"],
    [{ version: ["2.0.0"], extensions: [] }, "The answer is invalid at extensions"],
    [{ version: ["2.0.0"], other: 1 }, 'unexpected property "other"'],
  ])("refuses the answer %j", async (body, sentence) => {
    await expect(clientOf(fakeLrs(() => ({ body }))).about()).rejects.toThrow(sentence);
  });

  it("refuses options that are not valid", async () => {
    const lrs = fakeLrs(() => ({ body: { version: ["2.0.0"] } }));
    await expect(clientOf(lrs).about(fromJson('{"signal":5}'))).rejects.toThrow(
      "The option signal must be an AbortSignal, found 5.",
    );
    await expect(clientOf(lrs).about(fromJson("null"))).rejects.toThrow(DataError);
    expect(lrs.requests).toHaveLength(0);
  });
});
