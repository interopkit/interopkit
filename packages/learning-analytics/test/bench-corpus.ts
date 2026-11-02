import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CALIPER_1_1_CONTEXT,
  CALIPER_CONTEXT,
  type CaliperVersion,
  readEntity,
  readEvent,
} from "@interopkit/learning-analytics";
import { expect } from "vitest";
import { readSchemaSet, schemaSetValidator } from "../../../scripts/schema-oracle.js";
import { EVENTS } from "./budgets.js";

/** The `caliper-spec` repository at the pinned commit, which `pnpm corpus` downloads. */
const CALIPER_SPEC = resolve(import.meta.dirname, "../../../.cache/corpus/caliper-spec");

/** The fixtures of a kind of document that `caliper-spec` shows for a version, parsed. */
function fixturesOf(version: CaliperVersion, kind: "Event" | "Entity"): Record<string, unknown>[] {
  const directory = join(CALIPER_SPEC, "fixtures", version === "1.2" ? "v1p2" : "v1p1");
  return readdirSync(directory)
    .filter((name) => name.startsWith(`caliper${kind}`) && name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")));
}

/** The identifier of the event at an index: a UUID URN that no other event of the batch has. */
const idAt = (index: number): string => `urn:uuid:3a648e68-f00d-4c08-aa59-${index.toString(16).padStart(12, "0")}`;

/** The draft 4 schemas of a version in `caliper-spec`, as a function that tells whether a document is valid by the schema of its type. */
export function schemaCheck(version: CaliperVersion): (document: object) => boolean {
  const set = readSchemaSet(join(CALIPER_SPEC, "json_schema", version === "1.2" ? "schema_1_2" : "schema_1_1"));
  const validators = new Map<string, (value: unknown) => boolean>();
  return (document) => {
    const type = String(Reflect.get(document, "type"));
    let validator = validators.get(type);
    if (validator === undefined) {
      validator = schemaSetValidator(set, type, "4");
      validators.set(type, validator);
    }
    return validator(document);
  };
}

/** Tells whether the readers of the package and the schemas take a document of a kind; a class without a schema is left out. */
function bothTake(
  version: CaliperVersion,
  kind: "Event" | "Entity",
  document: Record<string, unknown>,
  accepts: (document: object) => boolean,
): boolean {
  try {
    if (kind === "Event") readEvent(document, { version });
    else readEntity(document, { version });
    return accepts(document);
  } catch {
    return false;
  }
}

/**
 * A batch of documents of a kind that the schemas of the version and the readers all take, one fixture after another; an event has
 * its own identifier.
 */
export function batchOf(
  version: CaliperVersion,
  kind: "Event" | "Entity",
  accepts: (document: object) => boolean,
): Record<string, unknown>[] {
  const fixtures = fixturesOf(version, kind).filter((document) => bothTake(version, kind, document, accepts));
  expect(fixtures.length).toBeGreaterThan(20);
  return Array.from({ length: EVENTS }, (_, index) => {
    const fixture = fixtures[index % fixtures.length] ?? {};
    return kind === "Event" ? { ...fixture, id: idAt(index) } : fixture;
  });
}

/** The envelope that a sensor of a version sends with a batch of events. */
export const envelopeOf = (version: CaliperVersion, data: readonly unknown[]): Record<string, unknown> => ({
  sensor: "https://exam.example/sensors/1",
  sendTime: "2023-11-14T22:13:20.000Z",
  dataVersion: version === "1.2" ? CALIPER_CONTEXT : CALIPER_1_1_CONTEXT,
  data,
});
