// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers are those of their specifications.

import { type Clock, DataError, type Fetch, ServiceError } from "@interopkit/core";
import { CALIPER_CONTEXT } from "@interopkit/learning-analytics";
import { describe, expect, it } from "vitest";
import { ATTEMPT, runScenario } from "../scenario.ts";
import type { AttemptRecord } from "../src/attempt.ts";
import { createSensor, MAX_ATTEMPTS } from "../src/sensor.ts";

const UUID_URN = /^urn:uuid:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;

/** A sensor over a `fetch` that answers every request with the next status, and the requests it received. */
function sensorWith(
  statuses: readonly number[],
  more: Partial<Parameters<typeof createSensor>[0]> = {},
): {
  readonly report: ReturnType<typeof createSensor>["report"];
  readonly ping: ReturnType<typeof createSensor>["ping"];
  readonly bodies: string[];
  readonly headers: Readonly<Record<string, string>>[];
} {
  const bodies: string[] = [];
  const headers: Readonly<Record<string, string>>[] = [];
  const fetch: Fetch = async (_url, init) => {
    bodies.push(typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body));
    headers.push(init.headers);
    const status = statuses[Math.min(bodies.length, statuses.length) - 1] ?? 200;
    const configuration = JSON.stringify({ caliperMaximumPayloadSize: 4, caliperSupportedVersions: [CALIPER_CONTEXT] });
    return new Response(init.method === "GET" && status === 200 ? configuration : null, { status });
  };
  let now = 1_700_000_000_000;
  const clock: Clock = { now: () => (now += 1_000) };
  const { report, ping } = createSensor({
    endpoint: "https://lrs.example/caliper",
    token: "token-123",
    fetch,
    sensor: "https://exam.example/sensors/1",
    edApp: "https://exam.example",
    clock,
    ...more,
  });
  return { report, ping, bodies, headers };
}

const parse = (body: string | undefined): { sendTime: string; data: { id: string; type: string; action: string }[] } =>
  JSON.parse(body ?? "");

describe("the scenario", () => {
  it("sends the events of the attempt twice, because the first answer is a 503", async () => {
    const received = await runScenario();
    expect(received.map(({ status }) => status)).toStrictEqual([503, 200]);
    const [first, second] = received.map(({ body }) => parse(body));
    expect(first?.data.map(({ type, action }) => `${type} ${action}`)).toStrictEqual([
      "AssessmentEvent Started",
      "AssessmentEvent Submitted",
      "GradeEvent Graded",
    ]);
    expect(second?.data).toStrictEqual(first?.data);
  });

  it("gives the second send the same identifiers and a later time of sending", async () => {
    const [first, second] = (await runScenario()).map(({ body }) => parse(body));
    const ids = first?.data.map(({ id }) => id) ?? [];
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(UUID_URN);
    expect(second?.data.map(({ id }) => id)).toStrictEqual(ids);
    expect(Date.parse(second?.sendTime ?? "")).toBeGreaterThan(Date.parse(first?.sendTime ?? ""));
  });
});

describe("the sensor", () => {
  it("reports only what an attempt has so far", async () => {
    const open: AttemptRecord = {
      id: "attempt-2",
      learner: ATTEMPT.learner,
      assessment: ATTEMPT.assessment,
      startedAt: 0,
    };
    const { report, bodies } = sensorWith([200]);
    await report(open);
    expect(parse(bodies[0]).data.map(({ action }) => action)).toStrictEqual(["Started"]);
    await report({ ...open, submittedAt: 1_000 });
    expect(parse(bodies[1]).data.map(({ action }) => action)).toStrictEqual(["Started", "Submitted"]);
  });

  it("gives the events of an attempt the same identifiers each time it is reported", async () => {
    const { report, bodies } = sensorWith([200]);
    await report(ATTEMPT);
    await report(ATTEMPT);
    expect(parse(bodies[1]).data).toStrictEqual(parse(bodies[0]).data);
  });

  it("gives different attempts different identifiers", async () => {
    const { report, bodies } = sensorWith([200]);
    await report(ATTEMPT);
    await report({ ...ATTEMPT, id: "attempt-2" });
    const [one, two] = bodies.map((body) => parse(body).data.map(({ id }) => id));
    expect(one?.filter((id) => two?.includes(id))).toStrictEqual([]);
  });

  it("sends a refusal of the endpoint once, because the same envelope would get the same answer", async () => {
    const { report, bodies } = sensorWith([422]);
    const error = await report(ATTEMPT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 422 });
    expect(bodies).toHaveLength(1);
  });

  it("stops after the most sends when the endpoint keeps failing, and rejects with the last failure", async () => {
    const { report, bodies } = sensorWith([503]);
    await expect(report(ATTEMPT)).rejects.toMatchObject({ status: 503 });
    expect(bodies).toHaveLength(MAX_ATTEMPTS);
  });

  it("does not send when the signal is already aborted, and rejects with its reason", async () => {
    const { report, bodies } = sensorWith([200]);
    const reason = new Error("The job was cancelled");
    await expect(report(ATTEMPT, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(bodies).toHaveLength(0);
  });

  it("asks the endpoint for its configuration, with the same token", async () => {
    const { ping, headers } = sensorWith([200]);
    expect(await ping()).toStrictEqual({
      status: "available",
      configuration: { caliperMaximumPayloadSize: 4, caliperSupportedVersions: [CALIPER_CONTEXT] },
    });
    expect(headers[0]).toStrictEqual({ Authorization: "Bearer token-123" });
  });

  it("sends without an Authorization header to an endpoint that asks for no token", async () => {
    const { report, headers } = sensorWith([200], { token: undefined });
    await report(ATTEMPT);
    expect(headers[0]).toStrictEqual({ "Content-Type": "application/json" });
  });

  it("does not send an envelope above the size that the endpoint takes, and does not try again", async () => {
    const { report, bodies } = sensorWith([200], { maxPayloadBytes: 1_024 });
    await expect(report(ATTEMPT)).rejects.toThrow(DataError);
    expect(bodies).toHaveLength(0);
  });
});
