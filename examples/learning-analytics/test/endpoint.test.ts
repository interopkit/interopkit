import { CALIPER_1_1_CONTEXT, CALIPER_CONTEXT } from "@interopkit/learning-analytics";
import { describe, expect, it } from "vitest";
import { ATTEMPT, OLDER_ATTEMPT, runScenario } from "../scenario.ts";
import { createEndpoint } from "../src/endpoint.ts";
import { sendFromOlderSensor } from "../src/legacy-sensor.ts";
import { createSensor } from "../src/sensor.ts";

const ORIGIN = "https://lrs.example";
const SENDERS = [
  { token: "token-123", principal: "exam-app" },
  { token: "token-old", principal: "exam-app-1-1" },
] as const;

/** A sensor of the current version that sends to an endpoint, with the clock at a fixed time. */
function sensorTo(
  endpoint: ReturnType<typeof createEndpoint>,
  changes: Partial<Parameters<typeof createSensor>[0]> = {},
) {
  return createSensor({
    endpoint: `${ORIGIN}/caliper`,
    token: "token-123",
    fetch: endpoint.fetch,
    sensor: "https://exam.example/sensors/1",
    edApp: "https://exam.example",
    clock: { now: () => 1_700_003_600_000 },
    ...changes,
  });
}

/** An older sensor's options, with the time fixed. */
const olderTo = (endpoint: ReturnType<typeof createEndpoint>, token = "token-old") => ({
  endpoint: `${ORIGIN}/caliper`,
  token,
  fetch: endpoint.fetch,
  sensor: "https://exam.example/sensors/old",
  sendTime: 1_700_003_600_000,
});

describe("the scenario against the endpoint", () => {
  it("holds each event once, though the attempt is reported twice and the first send failed", async () => {
    const { held, log } = await runScenario();
    expect(held.filter(({ principal }) => principal === "exam-app").map(({ type }) => type)).toStrictEqual([
      "AssessmentEvent",
      "AssessmentEvent",
      "GradeEvent",
    ]);
    expect(log.slice(0, 2).map(({ stored, again }) => [stored, again])).toStrictEqual([
      [3, 0],
      [0, 3],
    ]);
  });

  it("reads the envelope of the older sensor into the same shape as the current one, and names its version", async () => {
    const { held, log } = await runScenario();
    const older = held.filter(({ principal }) => principal === "exam-app-1-1");
    expect(older.map(({ type }) => type)).toStrictEqual(["Person", "AssessmentEvent"]);
    expect(older.every(({ dataVersion }) => dataVersion === CALIPER_1_1_CONTEXT)).toBe(true);
    expect(log[2]).toMatchObject({ status: 200, dataVersion: CALIPER_1_1_CONTEXT, stored: 2, again: 0, findings: [] });
    expect(held[0]?.dataVersion).toBe(CALIPER_CONTEXT);
  });

  it("announces both versions, answers 401 to an unknown token and 422 to an envelope of a version it does not read", async () => {
    const { versions, refusals } = await runScenario();
    expect(versions).toStrictEqual([CALIPER_CONTEXT, CALIPER_1_1_CONTEXT]);
    expect(refusals).toStrictEqual({ unknownToken: 401, olderVersion: 422 });
  });
});

describe("the endpoint", () => {
  it("names the sender by its token and not by the sensor that the envelope names", async () => {
    const endpoint = createEndpoint({ origin: ORIGIN, senders: SENDERS });
    await sensorTo(endpoint).report(ATTEMPT);
    await sendFromOlderSensor(OLDER_ATTEMPT, olderTo(endpoint));
    expect(new Set(endpoint.held().map(({ principal }) => principal))).toStrictEqual(
      new Set(["exam-app", "exam-app-1-1"]),
    );
  });

  it("replaces an entity by the describe that arrives last, and keeps the first copy of an event", async () => {
    const endpoint = createEndpoint({ origin: ORIGIN, senders: SENDERS });
    await sendFromOlderSensor(OLDER_ATTEMPT, olderTo(endpoint));
    await sendFromOlderSensor(OLDER_ATTEMPT, olderTo(endpoint));
    expect(endpoint.held()).toHaveLength(2);
    expect(endpoint.log().map(({ stored, again }) => [stored, again])).toStrictEqual([
      [2, 0],
      [0, 2],
    ]);
  });

  it("does not hold an envelope of a version that it does not read", async () => {
    const endpoint = createEndpoint({ origin: ORIGIN, senders: SENDERS, versions: ["1.2"] });
    await expect(sendFromOlderSensor(OLDER_ATTEMPT, olderTo(endpoint))).rejects.toMatchObject({ status: 422 });
    expect(endpoint.held()).toStrictEqual([]);
    expect(endpoint.log()).toStrictEqual([{ status: 422, stored: 0, again: 0, findings: [] }]);
  });

  it("answers 401 to a token it does not know and to a request with none", async () => {
    const endpoint = createEndpoint({ origin: ORIGIN, senders: SENDERS });
    await expect(sensorTo(endpoint, { token: "nope" }).report(ATTEMPT)).rejects.toMatchObject({ status: 401 });
    await expect(sensorTo(endpoint, { token: undefined }).report(ATTEMPT)).rejects.toMatchObject({ status: 401 });
    expect(endpoint.held()).toStrictEqual([]);
  });

  it("holds what reads and lists the findings of what does not, with their paths", async () => {
    const endpoint = createEndpoint({ origin: ORIGIN, senders: SENDERS });
    await sendFromOlderSensor({ ...OLDER_ATTEMPT, learner: "not-an-iri" }, olderTo(endpoint));
    expect(endpoint.held()).toStrictEqual([]);
    expect(endpoint.log()[0]?.findings.every((finding) => finding.startsWith("error data["))).toBe(true);
    expect(endpoint.log()[0]).toMatchObject({ status: 200, stored: 0 });
  });

  it("answers the configuration to a GET and refuses an address that is not its own", async () => {
    const endpoint = createEndpoint({ origin: ORIGIN, senders: SENDERS });
    expect(await sensorTo(endpoint).ping()).toStrictEqual({
      status: "available",
      configuration: {
        caliperMaximumPayloadSize: 1024,
        caliperSupportedVersions: [CALIPER_CONTEXT, CALIPER_1_1_CONTEXT],
      },
    });
    await expect(
      endpoint.fetch("https://other.example/caliper", {
        method: "GET",
        headers: {},
        redirect: "manual",
        signal: AbortSignal.timeout(1_000),
      }),
    ).rejects.toThrow("Nothing answers at https://other.example/caliper.");
  });
});
