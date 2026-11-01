import jsonld from "@interop/jsonld";
import type { CallOptions } from "@interopkit/core";
import { checkAbortSignal, checkFunction, checkRecord, isRecord } from "@interopkit/core/checks";
import type { ContextLoader, IssuableCredential, JsonLdIssue } from "../model/index.js";
import { documentLoaderOf, failOperation } from "./document-loader.js";

/** The most events that are collected, so that a credential of ten thousand unknown terms costs no more than this. */
const MAX_ISSUES = 100;

/** The members of the details of an event that name what it is about, in the order that they are looked for. */
const TERM_MEMBERS = ["property", "id", "type", "value", "term"] as const;

/** What the processor reports of an event: the term or value that it is about. */
function termOf(details: unknown): string {
  const about = isRecord(details) ? details : {};
  const named = TERM_MEMBERS.map((name) => about[name]).find((value) => typeof value === "string");
  return typeof named === "string" ? named : "";
}

/** Escapes a name as a segment of a JSON Pointer (RFC 6901 section 3). */
function segment(name: string): string {
  return name.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Finds the first place in a JSON value where a name is a property or a value, as a JSON Pointer. */
function pathOf(value: unknown, term: string, path = ""): string | undefined {
  const members: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : isRecord(value)
      ? Object.entries(value).map(([name, member]) => [segment(name), member])
      : [];
  for (const [name, member] of members) {
    const here = `${path}/${name}`;
    if ((isRecord(value) && name === segment(term)) || member === term) return here;
    const found = pathOf(member, term, here);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Lists what JSON-LD processing in safe mode would drop or refuse in a credential: a property that no context defines, a
 * relative `id` or `type`, a value of a type that its term does not allow.
 *
 * @remarks
 * Issuer conformance asks that a credential survive safe mode (Open Badges conformance 3). The credential is expanded with the
 * contexts of `contexts` only; nothing is fetched from anywhere else. Each event of the processor is a finding. At most 100 are
 * reported.
 *
 * @param credential - The credential.
 * @param options - The loader of contexts, and the signal that ends the caller's wait.
 * @returns The findings, none when nothing would be lost.
 * @throws `DataError` when an argument is not valid, or a context is not pinned.
 * @throws `ServiceError` when a context cannot be fetched.
 * @throws The `reason` of the signal when it aborts.
 */
export async function validateJsonLd(
  credential: IssuableCredential,
  options: { readonly contexts: ContextLoader } & CallOptions,
): Promise<readonly JsonLdIssue[]> {
  checkRecord(credential, "The credential must be an object");
  checkRecord(options, "The options of validateJsonLd must be an object");
  const { contexts, signal } = options;
  checkFunction(contexts, "The option contexts must be a function");
  if (signal !== undefined) checkAbortSignal(signal, "The option signal");
  signal?.throwIfAborted();
  const issues: JsonLdIssue[] = [];
  const document = structuredClone(credential);
  const load = documentLoaderOf(contexts as ContextLoader, signal);
  // With an event handler the processor goes on after a context that failed to load, so the first failure is kept and thrown.
  let failure: unknown;
  const documentLoader = async (url: string) => {
    try {
      return await load(url);
    } catch (error) {
      failure ??= error;
      throw error;
    }
  };
  try {
    await jsonld.expand(document, {
      documentLoader,
      eventHandler: ({ event }: { event: { message?: unknown; details?: unknown } }) => {
        if (issues.length >= MAX_ISSUES) return;
        const term = termOf(event.details);
        issues.push({
          path: (term === "" ? undefined : pathOf(document, term)) ?? "",
          term,
          message: typeof event.message === "string" ? event.message : "The processor reports an event.",
        });
      },
    });
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) return failOperation(failure, signal);
  return issues;
}
