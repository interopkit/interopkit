import { DataError } from "@interopkit/core";
import {
  DEFAULT_MAX_FINDINGS,
  describeRefusal,
  type FindingSink,
  type Issue,
  isRecord,
  nonEmptyStringSchema,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import {
  CALIPER_VERSIONS,
  type CaliperEvent,
  type CaliperVersion,
  type EntityDocument,
  EVENT_TYPES,
} from "../model/index.js";
import { time } from "../read/internal.js";
import { DEPRECATED_IN_1_1 } from "../v1p1/index.js";
import { findingSink, inspectEntity, inspectEvent } from "../validate/internal.js";
import type { CaliperEndpointOptions } from "./options.js";
import { versionsSchema } from "./options.js";
import type { ReceivedEnvelope } from "./received-envelope.js";
import { contextOfVersion, versionOfContext } from "./versions.js";

/** The four properties of an envelope, and no other: section 5.2 says that no custom properties are permitted. */
const envelopeSchema = strictRecord({
  sensor: nonEmptyStringSchema,
  sendTime: time,
  dataVersion: v.string(),
  data: v.pipe(v.array(v.unknown()), v.nonEmpty()),
});

const readOptionsSchema = strictRecord({
  versions: v.optional(versionsSchema),
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

/** The terms of the events that Caliper 1.1 deprecated, which the reader of an event refuses with the reason. */
const RETIRED_EVENTS: readonly unknown[] = DEPRECATED_IN_1_1.events;

/**
 * Tells whether an item of `data` is an event: an object whose `type` is that of an event, or of one that Caliper 1.1 deprecated.
 * Anything else is read as an entity.
 */
function isEvent(item: unknown): boolean {
  return isRecord(item) && (EVENT_TYPES.some((type) => type === item.type) || RETIRED_EVENTS.includes(item.type));
}

/** Writes a path inside the item that has the index: `data[2]`, `data[2].actor` and `data[2]["@context"]`. */
function placed(index: number): (finding: Issue) => Issue {
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
function readItems(
  items: readonly unknown[],
  sink: FindingSink<Issue>,
  version: CaliperVersion,
  parsed: boolean,
): (CaliperEvent | EntityDocument)[] {
  const data: (CaliperEvent | EntityDocument)[] = [];
  items.forEach((item, index) => {
    const inner = sink.within(placed(index));
    const read = isEvent(item)
      ? inspectEvent(item, inner, version, parsed)
      : inspectEntity(item, inner, version, parsed);
    if (read !== undefined) data.push(read);
  });
  return data;
}

/**
 * Makes the envelope that an endpoint hands to its host: the fields, the principal who sent it, and the items that read, as the
 * version of Caliper reads them, with what was found in them. The items of an envelope that `JSON.parse` made of a request
 * within the depth of `MAX_JSON_DEPTH` are JSON that nothing else holds, and are read without a copy; those of a host are copied.
 */
export function assembleEnvelope(
  fields: EnvelopeFields,
  principal: string,
  maxFindings: number | undefined,
  version: CaliperVersion,
  parsed: boolean,
): ReceivedEnvelope {
  const sink = findingSink(maxFindings ?? DEFAULT_MAX_FINDINGS);
  const data = readItems(fields.data, sink, version, parsed);
  return {
    principal,
    sensor: fields.sensor,
    sendTime: fields.sendTime,
    dataVersion: contextOfVersion(version),
    data,
    findings: sink.list(),
  };
}

/** The sentence that refuses an envelope under `strict`, or `undefined` when no item has an error. */
export function strictRefusal(envelope: ReceivedEnvelope): string | undefined {
  const errors = envelope.findings.filter(({ severity }) => severity === "error");
  return errors.length === 0 ? undefined : describeRefusal("The envelope", errors, "readEnvelope without strict");
}

/**
 * Reads an envelope that an endpoint received, as `handleCaliperRequest` does after it has authorized the request and parsed the
 * body: its fields, its version and its items.
 *
 * @remarks
 * The items are read by `validateEvent` and `validateEntity` as the version of the `dataVersion` defines them: an event or an
 * entity describe that reads is in `data`, with the warnings of its profile in `findings` (those of 1.2 alone), and one that does
 * not read is left out and named in `findings` as an error. With `strict` an item with an error refuses the envelope. The value
 * is copied, and nothing of it is kept.
 *
 * @param value - The envelope: the parsed text of a request.
 * @param principal - Who sent it, as the host named them; it goes into the result, and the `sensor` of the envelope does not.
 * @param options - The versions that it reads, the most findings to list, and whether an error in an item refuses the envelope.
 * @returns The envelope that the host receives.
 * @throws `DataError` when the principal is not a non-empty string, the options are not valid, the value is not an envelope of
 * section 5.2, its `dataVersion` is the context of a version that the options leave out or of none, or, with `strict`, an item
 * has an error.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2#envelope-0 | Caliper Analytics 1.2, Envelope}
 */
export function readEnvelope(
  value: unknown,
  principal: string,
  options?: Pick<CaliperEndpointOptions, "versions" | "maxFindings" | "strict">,
): ReceivedEnvelope {
  const who = parseWith(nonEmptyStringSchema, principal, "The principal");
  const settings = parseWith(readOptionsSchema, options === undefined ? {} : options, "The read options");
  const fields = parseEnvelope(value);
  const versions = settings.versions ?? CALIPER_VERSIONS;
  const version = versionOfContext(fields.dataVersion, versions);
  if (version === undefined) {
    throw new DataError(
      `The dataVersion of the envelope must be ${versions.map(contextOfVersion).join(" or ")}, the versions that the endpoint reads, found ${JSON.stringify(fields.dataVersion)}.`,
    );
  }
  const envelope = assembleEnvelope(fields, who, settings.maxFindings, version, false);
  const refusal = settings.strict === true ? strictRefusal(envelope) : undefined;
  if (refusal !== undefined) throw new DataError(refusal);
  return envelope;
}
