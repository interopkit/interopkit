import { callService, type Fetch } from "@interopkit/core";
import type { AttemptRecord } from "./attempt.ts";

/** The context of Caliper 1.1, which the package reads and never writes. */
const CALIPER_1_1 = "http://purl.imsglobal.org/ctx/caliper/v1p1";

/** Where the older sensor sends, as whom, and at what time. */
export interface LegacySensorOptions {
  /** The address of the Caliper endpoint, an `https` URL. */
  readonly endpoint: string;
  /** The bearer token that the endpoint validates. */
  readonly token: string;
  /** The `fetch` that makes the request. */
  readonly fetch: Fetch;
  /** The IRI of the sensor. */
  readonly sensor: string;
  /** The time of the sending, in milliseconds since the epoch. */
  readonly sendTime: number;
}

/**
 * Posts what a sensor of Caliper 1.1 sends when an attempt starts: an envelope that mixes the describe of the learner with the
 * `AssessmentEvent` of the start, written as 1.1 writes them, with the context of 1.1, no `profile` and the identifiers of an
 * older library.
 *
 * The package writes Caliper 1.2 alone, so this function writes the 1.1 documents by hand: it is what an older product does, and
 * what the endpoint must still take.
 *
 * @throws The `ServiceError` of the endpoint when it refuses the envelope.
 */
export async function sendFromOlderSensor(attempt: AttemptRecord, options: LegacySensorOptions): Promise<void> {
  const { endpoint, token, fetch, sensor, sendTime } = options;
  const started = new Date(attempt.startedAt).toISOString();
  const envelope = {
    sensor,
    sendTime: new Date(sendTime).toISOString(),
    dataVersion: CALIPER_1_1,
    data: [
      { "@context": CALIPER_1_1, id: attempt.learner, type: "Person" },
      {
        "@context": CALIPER_1_1,
        id: `urn:uuid:7e10e4f3-a0d8-4430-95bd-${attempt.id.replace(/\D/gu, "").padStart(12, "0")}`,
        type: "AssessmentEvent",
        actor: { id: attempt.learner, type: "Person" },
        action: "Started",
        object: { id: attempt.assessment, type: "Assessment" },
        eventTime: started,
      },
    ],
  };
  await callService({ fetch, timeoutMs: 10_000 }, "The endpoint", endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
}
