import { type Clock, type Fetch, ServiceError } from "@interopkit/core";
import type { AttemptRecord } from "./src/attempt.ts";
import { createEndpoint, type Logged, type Stored } from "./src/endpoint.ts";
import { sendFromOlderSensor } from "./src/legacy-sensor.ts";
import { createSensor } from "./src/sensor.ts";

/** One POST on the wire: the status the sensor saw, and the body it sent. */
export interface Received {
  readonly status: number;
  readonly body: string;
}

/** What the scenario shows: the wire, what the endpoint holds, and how it refused. */
export interface ScenarioResult {
  /** The POSTs of the two sensors, in order, with the status each got. */
  readonly sends: readonly Received[];
  /** The events and entities the endpoint holds, each once by `id`. */
  readonly held: readonly Stored[];
  /** What the endpoint made of each envelope it read. */
  readonly log: readonly Logged[];
  /** The versions that the endpoint announces in its configuration. */
  readonly versions: readonly string[];
  /** The status a sender with a token the endpoint does not know got, and the status the older sensor got from an endpoint that reads 1.2 alone. */
  readonly refusals: { readonly unknownToken: number; readonly olderVersion: number };
}

const ORIGIN = "https://lrs.example";
const ENDPOINT = `${ORIGIN}/caliper`;
const FIRST_TIME = 1_700_000_000_000;

/** The attempt of the scenario: submitted and graded by the host's scoring service. */
export const ATTEMPT: AttemptRecord = {
  id: "attempt-1",
  learner: "urn:uuid:3f0c8a8e-7b8e-4b6a-9c1d-2a4f6e8b0c1d",
  assessment: "https://exam.example/tests/42",
  startedAt: FIRST_TIME,
  submittedAt: FIRST_TIME + 1_800_000,
  grade: { given: 42, maximum: 50, scoredBy: "https://exam.example/scoring", at: FIRST_TIME + 1_860_000 },
};

/** An attempt that an older product, which sends Caliper 1.1, reports: the learner is another one. */
export const OLDER_ATTEMPT: AttemptRecord = {
  id: "attempt-7",
  learner: "urn:uuid:9a1d2c3b-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
  assessment: "https://exam.example/tests/43",
  startedAt: FIRST_TIME + 7_200_000,
};

const TOKENS = [
  { token: "token-123", principal: "exam-app" },
  { token: "token-old", principal: "exam-app-1-1" },
] as const;

/** Reads the body of a request as text. */
const textOf = (body: string | Uint8Array | undefined): string =>
  typeof body === "string" ? body : new TextDecoder().decode(body);

/** The status of the `ServiceError` that a call fails with, or 200 when it does not fail. */
async function statusOf(call: Promise<unknown>): Promise<number> {
  try {
    await call;
    return 200;
  } catch (error) {
    if (error instanceof ServiceError) return error.status;
    throw error;
  }
}

/**
 * Reports an attempt to an endpoint and shows what comes of it. The first send fails with a 503 before it reaches the endpoint,
 * as it may behind a load balancer, and the sensor sends again; the same attempt reported once more arrives with the same
 * identifiers and the endpoint holds each event once. An older sensor then sends an envelope of Caliper 1.1, which the endpoint
 * reads into the same model; a sender with an unknown token is refused with 401; and an endpoint that reads 1.2 alone answers
 * 422 to the envelope of 1.1.
 */
export async function runScenario(): Promise<ScenarioResult> {
  const endpoint = createEndpoint({ origin: ORIGIN, senders: TOKENS });
  const sends: Received[] = [];
  let posts = 0;
  // The wire records each POST and its answer. The first one never reaches the endpoint.
  const wire =
    (reach: Fetch): Fetch =>
    async (url, init) => {
      if (init.method !== "POST") return reach(url, init);
      const body = textOf(init.body);
      posts += 1;
      const response = posts === 1 ? new Response(null, { status: 503 }) : await reach(url, init);
      sends.push({ status: response.status, body });
      return response;
    };
  let now = FIRST_TIME + 3_600_000;
  // The clock moves on at every read, as time does between two sends.
  const clock: Clock = {
    now: () => {
      now += 1_000;
      return now;
    },
  };
  const sensor = createSensor({
    endpoint: ENDPOINT,
    token: "token-123",
    fetch: wire(endpoint.fetch),
    sensor: "https://exam.example/sensors/1",
    edApp: "https://exam.example",
    clock,
  });
  await sensor.report(ATTEMPT);
  await sensor.report(ATTEMPT);
  const ping = await sensor.ping();
  await sendFromOlderSensor(OLDER_ATTEMPT, {
    endpoint: ENDPOINT,
    token: "token-old",
    fetch: wire(endpoint.fetch),
    sensor: "https://exam.example/sensors/old",
    sendTime: clock.now(),
  });
  const stranger = createSensor({
    endpoint: ENDPOINT,
    token: "token-unknown",
    fetch: endpoint.fetch,
    sensor: "https://exam.example/sensors/2",
    edApp: "https://exam.example",
    clock,
  });
  const onlyCurrent = createEndpoint({ origin: ORIGIN, senders: TOKENS, versions: ["1.2"] });
  const refusals = {
    unknownToken: await statusOf(stranger.report(ATTEMPT)),
    olderVersion: await statusOf(
      sendFromOlderSensor(OLDER_ATTEMPT, {
        endpoint: ENDPOINT,
        token: "token-old",
        fetch: onlyCurrent.fetch,
        sensor: "https://exam.example/sensors/old",
        sendTime: clock.now(),
      }),
    ),
  };
  return {
    sends,
    held: endpoint.held(),
    log: endpoint.log(),
    versions: ping.status === "available" ? ping.configuration.caliperSupportedVersions : [],
    refusals,
  };
}

if (import.meta.main) {
  const { sends, held, log, versions, refusals } = await runScenario();
  for (const { status, body } of sends) {
    const envelope = JSON.parse(body);
    console.log(`${status} ${envelope.sendTime} ${envelope.data.map((item: { id: string }) => item.id).join(" ")}`);
  }
  console.log(`The endpoint reads ${versions.join(" and ")} and holds ${held.length} items.`);
  for (const { id, type, principal, dataVersion } of held) console.log(`${principal} ${dataVersion} ${type} ${id}`);
  console.log(
    `The endpoint answered ${log.map(({ status }) => status).join(", ")}; refusals: ${JSON.stringify(refusals)}`,
  );
}
