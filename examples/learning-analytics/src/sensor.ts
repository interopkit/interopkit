import { type CallOptions, type Clock, type Fetch, readClock, ServiceError } from "@interopkit/core";
import { type PingResult, pingEndpoint, sendCaliper } from "@interopkit/learning-analytics";
import type { AttemptRecord } from "./attempt.ts";
import { attemptEvents } from "./attempt-events.ts";

/** The most times the sensor sends one report when the endpoint fails. */
export const MAX_ATTEMPTS = 3;

/** Where the sensor sends, as whom, and what it reads the time from. */
export interface SensorOptions {
  /** The address of the Caliper endpoint, an `https` URL. */
  readonly endpoint: string;
  /** The bearer token that the endpoint validates, when it asks for one. */
  readonly token?: string;
  /** The `fetch` that makes the request. */
  readonly fetch: Fetch;
  /** The IRI of the sensor. */
  readonly sensor: string;
  /** The IRI of the application that delivers the assessment. */
  readonly edApp: string;
  /** The time of each sending. */
  readonly clock: Clock;
  /** The most bytes of an envelope that the endpoint takes, which its configuration says in kilobytes. */
  readonly maxPayloadBytes?: number;
}

/** A sensor that reports attempts. */
export interface Sensor {
  /**
   * Reports the events that an attempt has so far.
   *
   * @throws The `ServiceError` of the last send when every send failed, and the reason of the signal when it aborts.
   */
  report(attempt: AttemptRecord, call?: CallOptions): Promise<void>;
  /** Asks the endpoint whether it is available and what it takes. */
  ping(call?: CallOptions): Promise<PingResult>;
}

/** Tells whether sending the same events again can succeed: the endpoint did not answer, or failed on its side. */
function isTransient(error: unknown): boolean {
  return error instanceof ServiceError && (error.status === 0 || error.status >= 500);
}

/**
 * Creates a sensor. A report that fails with a transient error is sent again, up to {@link MAX_ATTEMPTS} times in all, with
 * the same events and so the same identifiers, and with the time of the new send. A refusal of the endpoint, such as 401
 * or 422, is not repeated: the same envelope would get the same answer. A host puts the backoff of its own queue between
 * the sends.
 */
export function createSensor(options: SensorOptions): Sensor {
  const { clock, edApp, ...sender } = options;
  return {
    ping: (call) => pingEndpoint(sender, call),
    async report(attempt, call) {
      const events = attemptEvents(attempt, edApp);
      for (let sent = 1; ; sent += 1) {
        try {
          await sendCaliper(events, { ...sender, sendTime: readClock(clock), signal: call?.signal });
          return;
        } catch (error) {
          if (sent >= MAX_ATTEMPTS || !isTransient(error)) throw error;
        }
      }
    },
  };
}
