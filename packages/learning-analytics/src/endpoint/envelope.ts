import { DataError } from "@interopkit/core";
import {
  DEFAULT_MAX_FINDINGS,
  type FindingSink,
  isRecord,
  nonEmptyStringSchema,
  parseWith,
  positiveIntegerSchema,
  refusalOf,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { CALIPER_CONTEXT, type CaliperEvent, type EntityDocument, EVENT_TYPES } from "../model/index.js";
import { time } from "../read/internal.js";
import type { CaliperFinding } from "../validate/index.js";
import { findingSink, inspectEntity, inspectEvent } from "../validate/internal.js";
import type { CaliperEndpointOptions } from "./options.js";
import type { ReceivedEnvelope } from "./received-envelope.js";

/** The four properties of an envelope, and no other: section 5.2 says that no custom properties are permitted. */
const envelopeSchema = strictRecord({
  sensor: nonEmptyStringSchema,
  sendTime: time,
  dataVersion: v.string(),
  data: v.pipe(v.array(v.unknown()), v.nonEmpty()),
});

const readOptionsSchema = strictRecord({
  maxFindings: v.optional(positiveIntegerSchema),
  strict: v.optional(v.boolean()),
});

/** The properties of an envelope whose fields are right, before its version and its data are read. */
export interface EnvelopeFields {
  readonly sensor: string;
  readonly sendTime: string;
  readonly dataVersion: string;
  readonly data: readonly unknown[];
}

/**
 * Reads the fields of an envelope: the four properties of section 5.2, a time in the form of Caliper, and at least one item.
 *
 * @throws `DataError` that names the path of the first fault.
 */
export function parseEnvelope(value: unknown): EnvelopeFields {
  return parseWith(envelopeSchema, value, "The envelope");
}

/** Tells whether an item of `data` is an event: an object whose `type` is that of an event. Anything else is read as an entity. */
function isEvent(item: unknown): boolean {
  return isRecord(item) && EVENT_TYPES.some((type) => type === item.type);
}

/** Writes a path inside the item that has the index: `data[2]`, `data[2].actor` and `data[2]["@context"]`. */
function placed(index: number): (finding: CaliperFinding) => CaliperFinding {
  const base = `data[${index}]`;
  return (finding) => {
    const { path } = finding;
    if (path === "") return { ...finding, path: base };
    return { ...finding, path: path.startsWith("[") ? `${base}${path}` : `${base}.${path}` };
  };
}

/**
 * Reads the items of an envelope, an event or an entity describe each by its `type`, and judges them into a sink of findings.
 * An item that does not read is left out; the checks go on after the sink is full, since the items that read are the data.
 */
function readItems(items: readonly unknown[], sink: FindingSink<CaliperFinding>): (CaliperEvent | EntityDocument)[] {
  const data: (CaliperEvent | EntityDocument)[] = [];
  items.forEach((item, index) => {
    const inner = sink.within(placed(index));
    const read = isEvent(item) ? inspectEvent(item, inner) : inspectEntity(item, inner);
    if (read !== undefined) data.push(read);
  });
  return data;
}

/**
 * Makes the envelope that an endpoint hands to its host: the fields, the principal who sent it, and the items that read with what
 * was found in them.
 */
export function assembleEnvelope(
  fields: EnvelopeFields,
  principal: string,
  maxFindings: number | undefined,
): ReceivedEnvelope {
  const sink = findingSink(maxFindings ?? DEFAULT_MAX_FINDINGS);
  const data = readItems(fields.data, sink);
  return {
    principal,
    sensor: fields.sensor,
    sendTime: fields.sendTime,
    dataVersion: CALIPER_CONTEXT,
    data,
    findings: sink.list(),
  };
}

/** The sentence that refuses an envelope under `strict`, or `undefined` when no item has an error. */
export function strictRefusal(envelope: ReceivedEnvelope): string | undefined {
  const errors = envelope.findings.filter(({ severity }) => severity === "error");
  return errors.length === 0 ? undefined : refusalOf("The envelope", errors, "readEnvelope without strict");
}

/**
 * Reads an envelope that an endpoint received, as `handleCaliperRequest` does after it has authorized the request and parsed the
 * body: its fields, its version and its items.
 *
 * @remarks
 * The items are read by `validateEvent` and `validateEntity`: an event or an entity describe that reads is in `data`, with the
 * warnings of its profile in `findings`, and one that does not read is left out and named in `findings` as an error. With
 * `strict` an item with an error refuses the envelope. The value is copied, and nothing of it is kept.
 *
 * @param value - The envelope: the parsed text of a request.
 * @param principal - Who sent it, as the host named them; it goes into the result, and the `sensor` of the envelope does not.
 * @param options - The most findings to list, and whether an error in an item refuses the envelope.
 * @returns The envelope that the host receives.
 * @throws `DataError` when the principal is not a non-empty string, the options are not valid, the value is not an envelope of
 * section 5.2, its `dataVersion` is not the context of Caliper 1.2, or, with `strict`, an item has an error.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2#envelope-0 | Caliper Analytics 1.2, Envelope}
 */
export function readEnvelope(
  value: unknown,
  principal: string,
  options?: Pick<CaliperEndpointOptions, "maxFindings" | "strict">,
): ReceivedEnvelope {
  const who = parseWith(nonEmptyStringSchema, principal, "The principal");
  const settings = parseWith(readOptionsSchema, options === undefined ? {} : options, "The read options");
  const fields = parseEnvelope(value);
  if (fields.dataVersion !== CALIPER_CONTEXT) {
    throw new DataError(
      `The dataVersion of the envelope must be ${CALIPER_CONTEXT}, the version that the endpoint reads, found ${JSON.stringify(fields.dataVersion)}.`,
    );
  }
  const envelope = assembleEnvelope(fields, who, settings.maxFindings);
  const refusal = settings.strict === true ? strictRefusal(envelope) : undefined;
  if (refusal !== undefined) throw new DataError(refusal);
  return envelope;
}
