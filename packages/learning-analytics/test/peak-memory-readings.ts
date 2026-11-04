import { type Reading, refusal } from "../../../scripts/peak-memory-child.js";
import { handleCaliperRequest, readEnvelope } from "../src/endpoint/index.js";
import { CALIPER_1_1_CONTEXT, CALIPER_CONTEXT, readEntity, readEvent, validateEvent } from "../src/index.js";
import { envelopeOf, post, recorder, request, soundAt } from "./endpoint-fixture.js";
import { STARTED_DOCUMENT } from "./fixture.js";

const MIB = 1024 * 1024;

/** The list of a million wrong values, which a reader refuses at the first and a validator stops at its limit of findings. */
const WRONG_VALUES = 1_000_000;

/** The most bytes of a body that the endpoint takes unless it is told another. */
const MAX_PAYLOAD_BYTES = 1_048_576;

/** The characters of each key: short keys put the most members, which cost the most memory for their bytes, in the body. */
const KEY_LENGTH = 14;

/** An event of Caliper 1.2 whose object holds a list of a million wrong values. */
const hostileEvent = () => ({
  ...STARTED_DOCUMENT,
  object: { id: "https://exam.example/tests/42", type: "Assessment", items: new Array(WRONG_VALUES).fill(0) },
});

const { profile: _profile, ...WITHOUT_PROFILE } = STARTED_DOCUMENT;

/** The event of Caliper 1.1 at the index. */
const eventAt1p1 = (index: number) => ({
  ...WITHOUT_PROFILE,
  "@context": CALIPER_1_1_CONTEXT,
  id: `urn:uuid:3a648e68-f00d-4c08-aa59-${String(index).padStart(12, "0")}`,
});

/** The same hostile event of Caliper 1.1. */
const hostileEvent1p1 = () => ({
  ...eventAt1p1(0),
  object: { id: "https://exam.example/tests/42", type: "Assessment", items: new Array(WRONG_VALUES).fill(0) },
});

/** The count of findings and the rule of the last. */
const describeFindings = (findings: readonly { readonly rule: string }[]): string =>
  `${findings.length} findings, the last ${findings.at(-1)?.rule}`;

/** The most events that an envelope of at most 1 MiB holds, made by `eventAt`. */
function fullEnvelope(eventAt: (index: number) => unknown, changes: Record<string, unknown> = {}) {
  let count = Math.floor(MIB / (JSON.stringify(eventAt(0)).length + 1));
  for (;;) {
    const envelope = envelopeOf(
      Array.from({ length: count }, (_, at) => eventAt(at)),
      changes,
    );
    if (JSON.stringify(envelope).length <= MIB) return envelope;
    count -= 1;
  }
}

/** The text of an envelope whose one event has extensions of as many distinct keys as the default limit of bytes takes. */
function widestEnvelope(): string {
  const text = JSON.stringify(envelopeOf([{ ...soundAt(0), extensions: {} }]));
  const [head, tail] = text.split('"extensions":{}');
  let members = "";
  for (
    let index = 0;
    `${head}"extensions":{${members}}${tail}`.length + KEY_LENGTH + 5 <= MAX_PAYLOAD_BYTES;
    index += 1
  ) {
    members += `${index === 0 ? "" : ","}"${String(index).padStart(KEY_LENGTH, "k")}":0`;
  }
  return `${head}"extensions":{${members}}${tail}`;
}

/** The readings of the package, by name. */
export const READINGS = {
  /** An event whose object holds a list of a million wrong values, refused at the first. */
  readEvent: {
    input: hostileEvent,
    read: (value: unknown) => refusal(() => readEvent(value)),
  },
  /** An entity whose members are a list of a million wrong values, refused at the first. */
  readEntity: {
    input: () => ({
      "@context": CALIPER_CONTEXT,
      id: "https://example.edu/sections/1",
      type: "CourseSection",
      members: new Array(WRONG_VALUES).fill(0),
    }),
    read: (value: unknown) => refusal(() => readEntity(value)),
  },
  /** An event of Caliper 1.2 judged with a list of a million wrong values: the findings stop at the limit. */
  validateEvent: {
    input: hostileEvent,
    read: (value: unknown) => describeFindings(validateEvent(value)),
  },
  /** An event of Caliper 1.1 judged with a list of a million wrong values. */
  validateEvent1p1: {
    input: hostileEvent1p1,
    read: (value: unknown) => describeFindings(validateEvent(value, { version: "1.1" })),
  },
  /** An envelope with a million wrong values: the findings of the limit and one that says it stopped. */
  readEnvelope: {
    input: () => envelopeOf([hostileEvent()]),
    read: (envelope: Record<string, unknown>) => {
      const read = readEnvelope(envelope, "tool-7");
      return `${read.data.length} events, ${describeFindings(read.findings)}`;
    },
  },
  /** An envelope of 1 MiB of events, handed to the host's `accept`. */
  endpointEnvelope: {
    input: () => post(fullEnvelope(soundAt)),
    read: async (body: ReturnType<typeof post>) => {
      const endpoint = recorder();
      const response = await handleCaliperRequest(body, endpoint.options);
      const received = endpoint.received[0];
      return `status ${response.status}, ${received?.data.length} events, ${received?.findings.length} findings`;
    },
  },
  /** An envelope of Caliper 1.1 of 1 MiB of events. */
  endpointEnvelope1p1: {
    input: () => post(fullEnvelope(eventAt1p1, { dataVersion: CALIPER_1_1_CONTEXT })),
    read: async (body: ReturnType<typeof post>) => {
      const endpoint = recorder();
      const response = await handleCaliperRequest(body, endpoint.options);
      const received = endpoint.received[0];
      return `status ${response.status}, ${received?.dataVersion === CALIPER_1_1_CONTEXT ? "1.1" : "another version"}, ${received?.data.length} events, ${received?.findings.length} findings`;
    },
  },
  /** An event whose extensions have as many distinct keys as 1 MiB holds. */
  endpointKeys: {
    input: () => request(widestEnvelope()),
    read: async (body: ReturnType<typeof request>) => {
      const endpoint = recorder();
      const response = await handleCaliperRequest(body, endpoint.options);
      return `status ${response.status}, ${endpoint.received[0]?.data.length} event`;
    },
  },
} satisfies Record<string, Reading>;
