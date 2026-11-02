import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { requireSchemas } from "../../../scripts/schemas.js";
import { CALIPER_CONTEXT } from "../src/index.js";

/** The terms of the published JSON-LD context of Caliper 1.2, which `pnpm schemas` downloads at a pinned hash. */
export const TERMS = new Map<string, unknown>(
  Object.entries(
    JSON.parse(readFileSync(join(requireSchemas(resolve(import.meta.dirname, "../../..")), "v1p2"), "utf8"))[
      "@context"
    ],
  ),
);

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks a value against the XML Schema type that the context coerces the term to (Caliper 1.2 section 4.3). */
function valueProblem(type: string, value: unknown): string | undefined {
  switch (type) {
    case "xsd:string":
      return typeof value === "string" ? undefined : "is not a string";
    case "xsd:dateTime":
      return typeof value === "string" && DATE_TIME.test(value) && !Number.isNaN(Date.parse(value))
        ? undefined
        : "is not YYYY-MM-DDTHH:mm:ss.SSSZ";
    case "xsd:duration":
      return typeof value === "string" && DURATION.test(value) ? undefined : "is not an ISO 8601 duration";
    case "xsd:decimal":
      return typeof value === "number" && Number.isFinite(value) ? undefined : "is not a decimal number";
    case "xsd:integer":
    case "xsd:long":
      return Number.isInteger(value) ? undefined : "is not an integer";
    case "xsd:nonNegativeInteger":
      return typeof value === "number" && Number.isInteger(value) && value >= 0
        ? undefined
        : "is not a non-negative integer";
    case "xsd:boolean":
      return typeof value === "boolean" ? undefined : "is not a boolean";
    default:
      return `has the type ${type}, which the checks do not know`;
  }
}

/** Checks one property of a node against its definition in the context. */
function propertyProblems(key: string, value: unknown, path: string, nested: (node: unknown, at: string) => string[]) {
  const definition = TERMS.get(key);
  if (definition === undefined) return [`${path}: the term ${key} is not defined by the Caliper context`];
  if (!isRecord(definition)) return [`${path}: ${key} is a node type or an action, not a property`];
  const coerced = definition["@type"];
  const list = definition["@container"] === "@list";
  const values = list ? (Array.isArray(value) ? value : []) : [value];
  if (list && !Array.isArray(value)) return [`${path}: ${key} is a list`];
  return values.flatMap((each, at) => {
    const where = list ? `${path}[${at}]` : path;
    if (coerced === "@id") {
      if (typeof each === "string") return URL.canParse(each) ? [] : [`${where}: ${each} is not an absolute IRI`];
      return isRecord(each) ? nested(each, where) : [`${where}: is neither an IRI nor an entity`];
    }
    if (coerced === "@vocab") {
      return typeof each === "string" && TERMS.has(each)
        ? []
        : [`${where}: ${String(each)} is not a term of the context`];
    }
    const problem = typeof coerced === "string" ? valueProblem(coerced, each) : "has no coercion";
    return problem === undefined ? [] : [`${where}: ${String(each)} ${problem}`];
  });
}

/** Returns what is wrong with a node of a Caliper document against the context: unknown terms, wrong value types. */
function nodeProblems(node: unknown, path: string): string[] {
  if (!isRecord(node)) return [`${path}: is not an object`];
  const problems: string[] = [];
  // The selector and the system identifier are entities with no id (Caliper 1.2 Appendix C).
  const hasNoId = node.type === "SystemIdentifier" || node.type === "TextPositionSelector";
  if (!hasNoId && (typeof node.id !== "string" || !URL.canParse(node.id)))
    problems.push(`${path}: id is not an absolute IRI`);
  const term = node.type;
  if (typeof term !== "string" || TERMS.get(term) !== `caliper:${term}`)
    problems.push(`${path}: type is not a node type`);
  for (const [key, value] of Object.entries(node)) {
    // The extensions are the sender's own, and no term of the context describes them.
    if (key === "id" || key === "type" || key === "extensions") continue;
    problems.push(...propertyProblems(key, value, `${path}.${key}`, nodeProblems));
  }
  return problems;
}

/**
 * Returns what is wrong with an event as a JSON-LD document of Caliper 1.2. It checks that the document names the Caliper
 * context, that every term is one the context defines, that every value has the type the context coerces its term to,
 * that the properties section 2.1 requires are there, and that the event's identifier is a URN of a UUID.
 */
export function eventProblems(event: unknown): string[] {
  if (!isRecord(event)) return ["The event is not an object."];
  const problems: string[] = [];
  if (event["@context"] !== CALIPER_CONTEXT) problems.push(`@context is ${String(event["@context"])}`);
  for (const required of ["id", "type", "actor", "action", "object", "eventTime"]) {
    if (event[required] === undefined) problems.push(`${required} is required and missing`);
  }
  if (typeof event.id !== "string" || !/^urn:uuid:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(event.id)) {
    problems.push("id is not urn:uuid:<UUID>");
  }
  const { "@context": _context, ...rest } = event;
  return [...problems, ...nodeProblems(rest, "event")];
}

/** The properties of an envelope, and no others (Caliper 1.2 section 5.2). */
const ENVELOPE_PROPERTIES = ["sensor", "sendTime", "dataVersion", "data"];

/** Returns what is wrong with a request body as a Caliper envelope, with its events checked as `eventProblems` does. */
export function envelopeProblems(envelope: unknown): string[] {
  if (!isRecord(envelope)) return ["The envelope is not an object."];
  const problems: string[] = [];
  const keys = Object.keys(envelope);
  if (keys.length !== ENVELOPE_PROPERTIES.length || !ENVELOPE_PROPERTIES.every((key) => keys.includes(key))) {
    problems.push(`The envelope has the properties ${keys.join(", ")}, not ${ENVELOPE_PROPERTIES.join(", ")}`);
  }
  if (typeof envelope.sensor !== "string" || !URL.canParse(envelope.sensor)) problems.push("sensor is not an IRI");
  if (typeof envelope.sendTime !== "string" || !DATE_TIME.test(envelope.sendTime))
    problems.push("sendTime is malformed");
  if (envelope.dataVersion !== CALIPER_CONTEXT) problems.push("dataVersion is not the Caliper context");
  if (!Array.isArray(envelope.data) || envelope.data.length === 0)
    return [...problems, "data is not a non-empty array"];
  return [...problems, ...envelope.data.flatMap((event, at) => eventProblems(event).map((p) => `data[${at}]: ${p}`))];
}
