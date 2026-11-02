import { describe, expect, it } from "vitest";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import { handleCaliperRequest } from "../src/endpoint/index.js";
import { CALIPER_CONTEXT, pingEndpoint } from "../src/index.js";
import { ROOT } from "./caliper-oracle.js";
import { post, recorder } from "./endpoint-fixture.js";
import { fakeEndpoint, SENDER } from "./fixture.js";

const blocks = readSpecPage(ROOT, "caliper-1p2.json");
const isObject = (block: unknown): block is Record<string, unknown> =>
  typeof block === "object" && block !== null && !Array.isArray(block);

describe("the endpoint and the sensor against the examples that the specification prints", () => {
  const envelopes = blocks.filter(
    (block): block is Record<string, unknown> =>
      isObject(block) &&
      "sensor" in block &&
      "sendTime" in block &&
      "dataVersion" in block &&
      Array.isArray(block.data),
  );

  it("receives every envelope that section 5.3 prints, each item as it is printed, with no error found in it", async () => {
    expect(envelopes.length).toBeGreaterThanOrEqual(2);
    for (const envelope of envelopes) {
      const endpoint = recorder({ strict: true });
      const response = await handleCaliperRequest(post(envelope), endpoint.options);
      expect(response.status).toBe(200);
      expect(endpoint.received[0]?.data).toStrictEqual(envelope.data);
      expect(endpoint.received[0]?.dataVersion).toBe(CALIPER_CONTEXT);
    }
  });

  it("reads the configuration of Figure 12 of section 6.2 as available, in the form that the page prints", async () => {
    const [configuration] = blocks.filter((block) => isObject(block) && "caliperSupportedVersions" in block);
    expect(configuration).toBeDefined();
    const endpoint = fakeEndpoint({ status: 200, body: JSON.stringify(configuration) });
    expect(await pingEndpoint({ ...SENDER, fetch: endpoint.fetch })).toStrictEqual({
      status: "available",
      configuration,
    });
  });
});
