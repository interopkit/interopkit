import type { Clock, Fetch } from "@interopkit/core";
import type { AttemptRecord } from "./src/attempt.ts";
import { createSensor } from "./src/sensor.ts";

/** What the scenario's endpoint received: the body of each POST, and the status that it answered with. */
export interface Received {
  readonly status: number;
  readonly body: string;
}

const ENDPOINT = "https://lrs.example/caliper";
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

/**
 * Reports the attempt to an endpoint that fails once with a 503 and then accepts the events, the way an endpoint behind a
 * load balancer may.
 *
 * @returns What the endpoint received, in order.
 */
export async function runScenario(): Promise<readonly Received[]> {
  const received: Received[] = [];
  const answers = [503, 200];
  const fetch: Fetch = async (_url, init) => {
    const status = answers[received.length] ?? 200;
    received.push({ status, body: typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body) });
    return new Response(null, { status });
  };
  let now = FIRST_TIME + 3_600_000;
  // The clock moves on at every read, as time does between two sends.
  const clock: Clock = { now: () => (now += 1_000) };
  const sensor = createSensor({
    endpoint: ENDPOINT,
    token: "token-123",
    fetch,
    sensor: "https://exam.example/sensors/1",
    edApp: "https://exam.example",
    clock,
  });
  await sensor.report(ATTEMPT);
  return received;
}

if (import.meta.main) {
  for (const { status, body } of await runScenario()) {
    const envelope = JSON.parse(body);
    console.log(`${status} ${envelope.sendTime} ${envelope.data.map((event: { id: string }) => event.id).join(" ")}`);
  }
}
