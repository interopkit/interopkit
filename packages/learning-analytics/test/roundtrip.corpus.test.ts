import type { Fetch } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { handleCaliperRequest } from "../src/endpoint/index.js";
import { EVENT_TYPES, readEntity, readEvent, sendCaliper } from "../src/index.js";
import { fixtures } from "./caliper-oracle.js";
import { recorder } from "./endpoint-fixture.js";

/** The `fetch` of a sensor that posts straight to the handler of an endpoint in the same process. */
function toEndpoint(endpoint: ReturnType<typeof recorder>): Fetch {
  return async (url, init) => {
    const body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : (init.body ?? new Uint8Array());
    const headers = Object.fromEntries(
      Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]),
    );
    const response = await handleCaliperRequest({ method: init.method, url, headers, body }, endpoint.options);
    return new Response(response.body.length === 0 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
}

describe("a sensor sends the envelopes of the fixtures of caliper-spec to an endpoint", () => {
  const envelopes = [...fixtures("caliperEnvelope")].map(([name, text]) => ({
    name,
    envelope: JSON.parse(text) as { sensor: string; sendTime: string; dataVersion: string; data: readonly unknown[] },
  }));

  it("gives the endpoint the sensor, the time and every event and entity as the fixture has them", async () => {
    expect(envelopes.length).toBeGreaterThan(10);
    for (const { name, envelope } of envelopes) {
      const data = envelope.data.map((item) =>
        EVENT_TYPES.some((type) => type === Reflect.get(item as object, "type")) ? readEvent(item) : readEntity(item),
      );
      const endpoint = recorder();
      await sendCaliper(data, {
        endpoint: "https://lrs.example/caliper",
        token: "token-123",
        fetch: toEndpoint(endpoint),
        sensor: envelope.sensor,
        sendTime: Date.parse(envelope.sendTime),
      });
      expect(endpoint.received, name).toHaveLength(1);
      expect(endpoint.received[0], name).toMatchObject({
        principal: "tool-7",
        sensor: envelope.sensor,
        sendTime: envelope.sendTime,
        dataVersion: envelope.dataVersion,
      });
      expect(endpoint.received[0]?.data, name).toStrictEqual(envelope.data);
    }
  });
});
