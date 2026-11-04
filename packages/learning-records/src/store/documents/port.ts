import { callPort } from "@interopkit/core";
import { looseRecord, nonEmptyStringSchema, parseWith } from "@interopkit/core/checks";
import * as v from "valibot";
import type { DocumentScope, DocumentTarget, LrsDocument, StateScope } from "../../model/index.js";
import { bytesSchema } from "../../read/internal.js";
import type { WriteCondition } from "../ports.js";
import { FAILED } from "../status.js";
import { type Context, refused, type Verdict } from "../verdict.js";

const storedSchema = looseRecord({
  contentType: v.string(),
  body: bytesSchema,
  etag: nonEmptyStringSchema,
  updated: v.pipe(
    v.string(),
    v.check((text) => !Number.isNaN(Date.parse(text)), "expected a time as ISO 8601 text"),
  ),
});

/** The most tries of a write or removal of a document that loses a race against another writer, the first one included. */
export const MAX_WRITE_TRIES = 3;

const writeSchema = v.picklist(["written", "precondition-failed", "exists"]);
const deleteSchema = v.picklist(["deleted", "precondition-failed", "absent"]);
const idsSchema = v.array(v.string());

/** Asks the store for a document, and checks the answer against the contract of the port. */
export async function fetchDocument(
  { settings }: Context,
  target: DocumentTarget,
): Promise<Verdict<LrsDocument | undefined>> {
  const { signal } = settings;
  const asked = await callPort(() => settings.documents.get(target, { signal }), { signal });
  if (asked === undefined) return refused(500, FAILED);
  if (asked.value === undefined) return { value: undefined };
  return { value: parseWith(storedSchema, asked.value, "The answer of DocumentStore.get") };
}

/** Writes a document if the condition holds. */
export async function storeDocument(
  { settings }: Context,
  target: DocumentTarget,
  document: LrsDocument,
  condition: WriteCondition,
): Promise<Verdict<"written" | "precondition-failed" | "exists">> {
  const { signal } = settings;
  const asked = await callPort(() => settings.documents.write(target, document, condition, { signal }), { signal });
  if (asked === undefined) return refused(500, FAILED);
  return { value: parseWith(writeSchema, asked.value, "The answer of DocumentStore.write") };
}

/** Removes a document if it has the tag. */
export async function removeDocument(
  { settings }: Context,
  target: DocumentTarget,
  ifMatch: string,
): Promise<Verdict<"deleted" | "precondition-failed" | "absent">> {
  const { signal } = settings;
  const asked = await callPort(() => settings.documents.delete(target, { ifMatch }, { signal }), { signal });
  if (asked === undefined) return refused(500, FAILED);
  return { value: parseWith(deleteSchema, asked.value, "The answer of DocumentStore.delete") };
}

/** Lists the ids of the documents of a scope, each once. */
export async function listDocuments(
  { settings }: Context,
  scope: DocumentScope,
  since: string | undefined,
): Promise<Verdict<readonly string[]>> {
  const { signal } = settings;
  const asked = await callPort(() => settings.documents.list(scope, since, { signal }), { signal });
  if (asked === undefined) return refused(500, FAILED);
  return { value: [...new Set(parseWith(idsSchema, asked.value, "The answer of DocumentStore.list"))] };
}

/** Removes every State document of a scope. */
export async function removeAll({ settings }: Context, scope: StateScope): Promise<Verdict<undefined>> {
  const { signal } = settings;
  const asked = await callPort(() => settings.documents.deleteAll(scope, { signal }), { signal });
  return asked === undefined ? refused(500, FAILED) : { value: undefined };
}
