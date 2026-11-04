import { DataError, ServiceError } from "@interopkit/core";
import { formatDateTime } from "@interopkit/core/checks";
import { describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { type CaliperEndpointOptions, handleCaliperRequest, type ReceivedEnvelope } from "../src/endpoint/index.js";
import {
  buildEntity,
  buildEvent,
  CALIPER_CONTEXT,
  mintUrn,
  pingEndpoint,
  readEntity,
  readEvent,
  sendCaliper,
  validateEvent,
} from "../src/index.js";
import type { IdFixture } from "./fixture.js";

/**
 * The path of a sensor in the engines of the browsers, where a Caliper sensor of a web application runs: the identifiers, the
 * times, the builders, the readers and the send to an endpoint, which the page holds so that the request and the answer are the
 * engine's own `Response` and streams.
 */

/** The file of the identifiers that Python computed, which a page reads through the command of the test runner: it has no file system. */
const IDS_FILE = "packages/learning-analytics/test/fixtures/caliper-ids.json";

const PERSON = "https://example.edu/users/554433";
const ASSESSMENT = "https://example.edu/assessments/1";
const SENDER = { endpoint: "https://lrs.example/caliper", token: "token-123", sensor: "https://example.edu/sensors/1" };

/** An event that follows every rule of its profile, with an identifier from the parts that name it. */
function startedEvent() {
  const at = formatDateTime(1_479_204_900_000);
  return buildEvent({
    id: mintUrn(["event", "attempt-1", "started"]),
    type: "AssessmentEvent",
    profile: "AssessmentProfile",
    actor: { id: PERSON, type: "Person" },
    action: "Started",
    object: { id: ASSESSMENT, type: "Assessment" },
    generated: {
      id: `${ASSESSMENT}/users/554433/attempts/1`,
      type: "Attempt",
      assignee: PERSON,
      assignable: ASSESSMENT,
      count: 1,
      startedAtTime: at,
    },
    eventTime: at,
  });
}

/** An endpoint in the page: the handler of the package behind a `fetch` that answers with the engine's `Response`. */
function localEndpoint(): { readonly fetch: typeof fetch; readonly received: ReceivedEnvelope[] } {
  const received: ReceivedEnvelope[] = [];
  const options: CaliperEndpointOptions = {
    authorize: async (token) => (token === SENDER.token ? { principal: "exam-app" } : undefined),
    accept: async (envelope) => {
      received.push(envelope);
    },
  };
  const local = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const body = new Uint8Array(await request.arrayBuffer());
    const answer = await handleCaliperRequest({ method: request.method, url: request.url, headers, body }, options);
    return new Response(answer.body === "" ? null : answer.body, { status: answer.status, headers: answer.headers });
  };
  return { fetch: local, received };
}

describe("the sensor in the engines of the browsers", () => {
  it("mints the identifiers that Python's uuid5 gives, with the build of uuid for browsers", async () => {
    const ids: IdFixture = JSON.parse(await commands.readFile(IDS_FILE));
    expect(ids.names.length).toBeGreaterThan(0);
    for (const { parts, uuid } of ids.names) expect(mintUrn(parts)).toBe(`urn:uuid:${uuid}`);
  });

  it("builds an event and an entity describe that the readers read back as they are, and that follow every rule", () => {
    const event = startedEvent();
    expect(event.eventTime).toBe("2016-11-15T10:15:00.000Z");
    expect(readEvent(JSON.parse(JSON.stringify(event)))).toStrictEqual(event);
    expect(validateEvent(event)).toStrictEqual([]);
    const person = buildEntity({ id: PERSON, type: "Person", name: "Ada" });
    expect(person).toStrictEqual({ "@context": CALIPER_CONTEXT, id: PERSON, type: "Person", name: "Ada" });
    expect(readEntity(JSON.parse(JSON.stringify(person)))).toStrictEqual(person);
  });

  it("sends an event and an entity describe to an endpoint, which receives them as the principal of the token", async () => {
    const endpoint = localEndpoint();
    const event = startedEvent();
    const person = buildEntity({ id: PERSON, type: "Person" });
    await sendCaliper([person, event], { ...SENDER, fetch: endpoint.fetch, sendTime: 1_479_204_901_000 });
    expect(endpoint.received).toHaveLength(1);
    expect(endpoint.received[0]).toMatchObject({
      principal: "exam-app",
      sensor: SENDER.sensor,
      sendTime: "2016-11-15T10:15:01.000Z",
      dataVersion: CALIPER_CONTEXT,
      findings: [],
    });
    expect(endpoint.received[0]?.data).toStrictEqual([person, event]);
    const refused = sendCaliper([event], { ...SENDER, token: "other", fetch: endpoint.fetch, sendTime: 0 });
    await expect(refused).rejects.toMatchObject({ status: 401 });
  });

  it("asks the endpoint for its configuration", async () => {
    expect(await pingEndpoint({ ...SENDER, fetch: localEndpoint().fetch })).toStrictEqual({
      status: "available",
      configuration: {
        caliperMaximumPayloadSize: 1024,
        caliperSupportedVersions: [CALIPER_CONTEXT, "http://purl.imsglobal.org/ctx/caliper/v1p1"],
      },
    });
  });

  it("follows no redirect, and ends a call that the endpoint never answers at the time limit", async () => {
    const event = startedEvent();
    const redirect = async () =>
      new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } });
    const moved = sendCaliper([event], { ...SENDER, fetch: redirect, sendTime: 0 });
    await expect(moved).rejects.toMatchObject({ status: 302 });
    const silent = () => new Promise<Response>(() => undefined);
    const stalled = sendCaliper([event], { ...SENDER, fetch: silent, sendTime: 0, timeoutMs: 50 });
    await expect(stalled).rejects.toBeInstanceOf(ServiceError);
    await expect(stalled).rejects.toMatchObject({ status: 0 });
  });

  it("refuses a value that nests too deep without exhausting the stack of the engine", () => {
    let object: Record<string, unknown> = { id: "https://example.edu/documents/0", type: "Document" };
    for (let depth = 1; depth < 100_000; depth += 1) {
      object = { id: `https://example.edu/documents/${depth}`, type: "Document", isPartOf: object };
    }
    const event = { ...JSON.parse(JSON.stringify(startedEvent())), type: "ViewEvent", action: "Viewed", object };
    expect(() => readEvent(event)).toThrow(DataError);
    expect(() => readEvent(event)).toThrow(/nests more than 64 levels/u);
  });
});
