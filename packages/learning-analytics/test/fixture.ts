import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fetch } from "@interopkit/core";
import { type AssessmentEvent, buildEvent, type CaliperEvent, caliperTime, mintUrn } from "../src/index.js";

/** The names and the UUIDs that Python's `uuid.uuid5` computed (`validation/caliper_ids.py`). */
interface IdFixture {
  readonly address: string;
  readonly namespace: string;
  readonly rfc9562: { readonly namespace: string; readonly name: string; readonly uuid: string };
  readonly names: readonly {
    readonly parts: readonly (string | number)[];
    readonly name: string;
    readonly uuid: string;
  }[];
}

/** The identifier fixture, read from the file that the validation script writes. */
export const IDS: IdFixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "caliper-ids.json"), "utf8"),
);

/**
 * Returns the URN that Python's `uuid.uuid5` gave for the parts.
 *
 * @throws `Error` when the script did not compute the parts.
 */
export function urnOf(...parts: readonly (string | number)[]): string {
  const key = JSON.stringify(parts);
  const found = IDS.names.find((entry) => JSON.stringify(entry.parts) === key);
  if (found === undefined) throw new Error(`validation/caliper_ids.py has no name ${key}: add it and run the script.`);
  return `urn:uuid:${found.uuid}`;
}

/** The session, the test and the parties of the tests, as `validation/caliper_ids.py` names them. */
export const SESSION = "s-1";
export const ASSESSMENT = "https://exam.example/tests/42";
export const ACTOR = "urn:uuid:3f0c8a8e-7b8e-4b6a-9c1d-2a4f6e8b0c1d";
const APPLICATION = "https://exam.example";
export const EVENT_TIME = 1_700_000_000_000;

/** The input of an event: the candidate starts the test. A test changes one property at a time. */
export function startedInput(): Omit<AssessmentEvent, "@context"> {
  return {
    id: urnOf("event", SESSION, "start", 0),
    type: "AssessmentEvent",
    profile: "AssessmentProfile",
    actor: { id: ACTOR, type: "Person" },
    action: "Started",
    object: { id: ASSESSMENT, type: "Assessment" },
    generated: {
      id: urnOf("attempt", SESSION),
      type: "Attempt",
      assignee: ACTOR,
      assignable: ASSESSMENT,
      startedAtTime: caliperTime(EVENT_TIME, "The time"),
    },
    eventTime: caliperTime(EVENT_TIME, "The time"),
    edApp: APPLICATION,
  };
}

/** The event that the candidate starts the test, as a document with its context: what a sender writes. */
export const STARTED_DOCUMENT = { "@context": "http://purl.imsglobal.org/ctx/caliper/v1p2", ...startedInput() };

/** An event of the tests, with the identifier of its index in a step. */
export function eventAt(index: number): CaliperEvent {
  return buildEvent({ ...startedInput(), id: mintUrn(["event", SESSION, 1, index]) });
}

/** The sender options of the tests, which the tests change one property at a time. */
export const SENDER = {
  endpoint: "https://lrs.example/caliper",
  token: "token-123",
  sensor: "https://exam.example/sensors/1",
  sendTime: 1_700_000_000_000,
};

/** A request that a fake endpoint recorded. */
interface RecordedRequest {
  readonly url: string;
  readonly init: Parameters<Fetch>[1];
}

/** A fake endpoint: records each request and answers it. */
export interface FakeEndpoint {
  /** The `fetch` to pass to the sensor. */
  readonly fetch: Fetch;
  /** The requests, in order. */
  readonly requests: RecordedRequest[];
}

/** What a fake endpoint answers: a status and a body, or a failure to answer. */
export type FakeReply = { readonly status: number; readonly body?: string } | { readonly fails: Error };

/** Creates a fake endpoint that gives each request the next reply, and the last one again after that. */
export function fakeEndpoint(...replies: readonly FakeReply[]): FakeEndpoint {
  const requests: RecordedRequest[] = [];
  const fetch: Fetch = async (url, init) => {
    requests.push({ url, init });
    const reply = replies[Math.min(requests.length, replies.length) - 1] ?? { status: 200 };
    if ("fails" in reply) throw reply.fails;
    return new Response(reply.body === undefined || reply.body === "" ? null : reply.body, { status: reply.status });
  };
  return { fetch, requests };
}

/** Returns a copy of a value as JSON passes it, for input that a host would send from JavaScript or JSON. */
export const fromJson = <T>(text: string): T => JSON.parse(text);
