import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { handleCaliperRequest } from "../src/endpoint/index.js";
import { CALIPER_CONTEXT, pingEndpoint } from "../src/index.js";
import { fixtures } from "./caliper-oracle.js";
import { post, recorder } from "./endpoint-fixture.js";
import { fakeEndpoint, SENDER } from "./fixture.js";

/** The envelopes of the fixtures of caliper-spec with their file names. */
const ENVELOPES = [...fixtures("caliperEnvelope")].map(([name, text]) => ({
  name,
  envelope: JSON.parse(text) as Record<string, unknown> & { readonly data: readonly unknown[] },
}));

/** The envelopes that give the General Profile to a navigation, which `validateEvent` finds an error in. */
const WITH_AN_ERROR = ["caliperEnvelopeEventBatch.json", "caliperEnvelopeEventThinned.json"];

describe("the endpoint against the envelopes of the fixtures of caliper-spec", () => {
  it("receives every envelope with every item that it holds, and answers 200 with an empty body", async () => {
    expect(ENVELOPES.length).toBeGreaterThan(10);
    for (const { name, envelope } of ENVELOPES) {
      const endpoint = recorder();
      const response = await handleCaliperRequest(post(envelope), endpoint.options);
      expect(response, name).toStrictEqual({ status: 200, headers: {}, body: "" });
      expect(endpoint.received[0]?.data, name).toStrictEqual(envelope.data);
      expect(endpoint.received[0]?.dataVersion, name).toBe(CALIPER_CONTEXT);
    }
  });

  it("refuses under strict only the envelopes that hold an event that breaks a rule of its profile", async () => {
    const refused: string[] = [];
    for (const { name, envelope } of ENVELOPES) {
      const response = await handleCaliperRequest(post(envelope), recorder({ strict: true }).options);
      if (response.status === 400) refused.push(name);
      else expect(response.status, name).toBe(200);
    }
    expect(refused.sort()).toStrictEqual(WITH_AN_ERROR);
  });
});

describe("the configuration of the fixtures of caliper-spec", () => {
  const fixture =
    [...fixtures("caliperEndpointConfig")].map(([, text]) => JSON.parse(text) as Record<string, unknown>)[0] ?? {};

  /** Writes the name of a property of the fixture as the table of section 6.2 does: `caliper_supported_versions` is `caliperSupportedVersions`. */
  const camel = (name: string): string => name.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase());

  it("is written with the names of the snake case, which section 6.2 does not use, and the sensor refuses it", async () => {
    const endpoint = fakeEndpoint({ status: 200, body: JSON.stringify(fixture) });
    await expect(pingEndpoint({ ...SENDER, fetch: endpoint.fetch })).rejects.toThrow(DataError);
  });

  it("is the configuration of the table once its names are those of the table", async () => {
    const renamed = Object.fromEntries(Object.entries(fixture).map(([name, value]) => [camel(name), value]));
    const endpoint = fakeEndpoint({
      status: 200,
      body: JSON.stringify(renamed),
    });
    expect(await pingEndpoint({ ...SENDER, fetch: endpoint.fetch })).toStrictEqual({
      status: "available",
      configuration: renamed,
    });
  });
});
