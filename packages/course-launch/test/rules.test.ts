import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { ACCEPTANCES, REFUSALS, SOUND } from "../../../scripts/cmi5-rules.js";
import {
  readLaunchData,
  readLaunchUrl,
  readLearnerPreferences,
  validateSessionStatements,
  writeLearnerPreferences,
} from "../src/index.js";

/** Judges a session of the table. */
const judged = (session: typeof SOUND) =>
  validateSessionStatements(
    JSON.parse(JSON.stringify(session.statements)),
    JSON.parse(JSON.stringify(session.facts)),
  ).map(({ path, rule, severity }) => ({ path, rule, severity }));

describe("the rules of the statements of a session, from the table of the specification", () => {
  it.each(REFUSALS.map((rule) => [`${rule.source}: ${rule.text}`, rule] as const))(
    "finds a session that breaks %s",
    (_title, rule) => {
      expect(judged(rule.fixture(SOUND))).toStrictEqual(rule.session);
    },
  );

  it.each(ACCEPTANCES.map((acceptance) => [acceptance.text, acceptance] as const))(
    "accepts %s",
    (_title, acceptance) => {
      expect(judged(acceptance.fixture(SOUND))).toStrictEqual([]);
    },
  );
});

const LAUNCH =
  "https://content.example.org/au/1/index.html?lesson=2" +
  `&endpoint=${encodeURIComponent("https://lms.example.org/xapi/")}` +
  `&fetch=${encodeURIComponent("https://lms.example.org/fetch?code=abc")}` +
  `&actor=${encodeURIComponent(JSON.stringify({ objectType: "Agent", account: { homePage: "https://lms.example.org", name: "learner-1" } }))}` +
  "&registration=1b0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d" +
  `&activityId=${encodeURIComponent("https://lms.example.org/courses/c1/au/1")}`;

describe("reading a launch URL", () => {
  it("reads the five parameters, decoded, whatever their order, and leaves the content's own", () => {
    const expected = {
      endpoint: "https://lms.example.org/xapi/",
      fetch: "https://lms.example.org/fetch?code=abc",
      actor: { objectType: "Agent", account: { homePage: "https://lms.example.org", name: "learner-1" } },
      registration: "1b0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d",
      activityId: "https://lms.example.org/courses/c1/au/1",
    };
    expect(readLaunchUrl(LAUNCH)).toStrictEqual(expected);
    const url = new URL(LAUNCH);
    const reversed = new URLSearchParams([...url.searchParams.entries()].reverse());
    expect(readLaunchUrl(`${url.origin}${url.pathname}?${reversed}`)).toStrictEqual(expected);
  });

  it.each([
    ["no endpoint", (url: URL) => url.searchParams.delete("endpoint"), "The launch URL has no parameter endpoint"],
    [
      "fetch twice",
      (url: URL) => url.searchParams.append("fetch", "https://lms.example.org/other"),
      "The launch URL has the parameter fetch 2 times",
    ],
    [
      "an endpoint over http",
      (url: URL) => url.searchParams.set("endpoint", "http://lms.example.org/xapi/"),
      "The parameter endpoint of the launch URL must be an absolute https URL",
    ],
    [
      "a fetch URL that is relative",
      (url: URL) => url.searchParams.set("fetch", "/fetch"),
      "The parameter fetch of the launch URL must be an absolute https URL",
    ],
    [
      "a registration that is no UUID",
      (url: URL) => url.searchParams.set("registration", "r-1"),
      'The parameter registration of the launch URL must be a UUID, found "r-1".',
    ],
    [
      "an activity id that is relative",
      (url: URL) => url.searchParams.set("activityId", "au/1"),
      "The parameter activityId of the launch URL must be a fully qualified IRI",
    ],
    [
      "an actor that is not JSON",
      (url: URL) => url.searchParams.set("actor", "{learner}"),
      "The actor of the launch URL is not JSON",
    ],
    [
      "an actor of many tokens",
      (url: URL) => url.searchParams.set("actor", JSON.stringify({ name: "x".repeat(1), list: Array(600).fill(1) })),
      "The actor of the launch URL has more than 1000 tokens",
    ],
    [
      "an actor with two identifiers",
      (url: URL) =>
        url.searchParams.set(
          "actor",
          JSON.stringify({ mbox: "mailto:a@example.org", account: { homePage: "https://lms.example.org", name: "a" } }),
        ),
      "The actor of the launch URL is invalid",
    ],
    [
      "an actor that is a Group",
      (url: URL) =>
        url.searchParams.set(
          "actor",
          JSON.stringify({ objectType: "Group", account: { homePage: "https://lms.example.org", name: "g" } }),
        ),
      "The actor of the launch URL is a Group, and cmi5 launches an Agent (9.2).",
    ],
    [
      "an actor without an account",
      (url: URL) => url.searchParams.set("actor", JSON.stringify({ mbox: "mailto:a@example.org" })),
      "The actor of the launch URL has no account",
    ],
  ])("refuses %s", (_title, change, sentence) => {
    const url = new URL(LAUNCH);
    change(url);
    expect(() => readLaunchUrl(url.href)).toThrow(sentence);
  });

  it("refuses a URL that is not one, that is too long, or is not a string", () => {
    expect(() => readLaunchUrl("index.html?endpoint=x")).toThrow(
      new DataError("The launch URL is not an absolute URL."),
    );
    expect(() => readLaunchUrl(`${LAUNCH}&x=${"a".repeat(65_536)}`)).toThrow(
      "The launch URL has more than 65536 characters",
    );
    for (const value of JSON.parse('[null, 5, {}, ["https://a.example"]]')) {
      expect(() => readLaunchUrl(value)).toThrow(/^The launch URL must be a string, found /u);
    }
  });
});

describe("reading the launch data", () => {
  const template = {
    contextActivities: { grouping: [{ id: "https://publisher.example.org/au/1" }] },
    extensions: { "https://w3id.org/xapi/cmi5/context/extensions/sessionid": "s-1" },
  };

  it("reads every property, and returnURL as returnUrl", () => {
    expect(
      readLaunchData({
        contextTemplate: template,
        launchMode: "Review",
        moveOn: "Passed",
        launchParameters: "Start=1",
        masteryScore: 0.75,
        returnURL: "https://lms.example.org/courses/c1",
        entitlementKey: { courseStructure: "xyz-123", alternate: "abc-456" },
      }),
    ).toStrictEqual({
      contextTemplate: template,
      launchMode: "Review",
      moveOn: "Passed",
      launchParameters: "Start=1",
      masteryScore: 0.75,
      returnUrl: "https://lms.example.org/courses/c1",
      entitlementKey: { courseStructure: "xyz-123", alternate: "abc-456" },
    });
  });

  it("reads a masteryScore of null and an entitlementKey of {}, as CATAPULT's player writes them, as absent, and drops other members", () => {
    expect(
      readLaunchData({
        contextTemplate: template,
        launchMode: "Normal",
        moveOn: "NotApplicable",
        masteryScore: null,
        entitlementKey: {},
        vendor: 1,
      }),
    ).toStrictEqual({ contextTemplate: template, launchMode: "Normal", moveOn: "NotApplicable" });
  });

  it.each([
    [null, "The launch data is invalid: expected an object, found null."],
    [{ contextTemplate: template, launchMode: "Play", moveOn: "Passed" }, "The launch data is invalid at launchMode"],
    [
      { contextTemplate: template, launchMode: "Normal", moveOn: "Passed", masteryScore: 1.5 },
      "The launch data is invalid at masteryScore",
    ],
    [
      { contextTemplate: template, launchMode: "Normal", moveOn: "Passed", entitlementKey: { alternate: "a" } },
      "The launch data is invalid at entitlementKey",
    ],
    [
      { contextTemplate: { registration: "r-1" }, launchMode: "Normal", moveOn: "Passed" },
      "The launch data at contextTemplate is invalid at registration",
    ],
    [{ launchMode: "Normal", moveOn: "Passed" }, "The launch data is invalid: missing"],
  ])("refuses %j", (value, sentence) => {
    expect(() => readLaunchData(JSON.parse(JSON.stringify(value)))).toThrow(sentence);
  });
});

describe("the preferences of a learner", () => {
  it("reads the languages in order and the audio, an empty list of languages, and absent properties, and drops other members", () => {
    expect(
      readLearnerPreferences({ languagePreference: "en-US,fr-FR,fr-BE", audioPreference: "off", theme: "dark" }),
    ).toStrictEqual({
      languagePreference: ["en-US", "fr-FR", "fr-BE"],
      audioPreference: "off",
    });
    expect(readLearnerPreferences({ languagePreference: "" })).toStrictEqual({ languagePreference: [] });
    expect(readLearnerPreferences({})).toStrictEqual({});
  });

  it.each([
    [null, "The preferences document is invalid: expected an object, found null."],
    [{ languagePreference: "en-US, fr-FR" }, "The preferences document is invalid at languagePreference"],
    [{ languagePreference: "en_US" }, "The preferences document is invalid at languagePreference"],
    [{ languagePreference: ["en"] }, "The preferences document is invalid at languagePreference"],
    [{ audioPreference: "loud" }, "The preferences document is invalid at audioPreference"],
  ])("refuses %j", (value, sentence) => {
    expect(() => readLearnerPreferences(JSON.parse(JSON.stringify(value)))).toThrow(sentence);
  });

  it("writes both properties, which the reader takes back", () => {
    const written = writeLearnerPreferences({ languagePreference: ["id-ID", "en"], audioPreference: "on" });
    expect(written).toStrictEqual({ languagePreference: "id-ID,en", audioPreference: "on" });
    expect(readLearnerPreferences(written)).toStrictEqual({
      languagePreference: ["id-ID", "en"],
      audioPreference: "on",
    });
  });

  it("refuses to write preferences without both properties, or with a tag that is not one", () => {
    expect(() => writeLearnerPreferences(JSON.parse('{ "audioPreference": "on" }'))).toThrow(
      'The preferences document is invalid: missing the property "languagePreference".',
    );
    expect(() => writeLearnerPreferences({ languagePreference: ["en,fr"], audioPreference: "on" })).toThrow(
      'The preferences document is invalid at languagePreference[0]: expected a language tag of RFC 5646, found "en,fr".',
    );
  });
});
