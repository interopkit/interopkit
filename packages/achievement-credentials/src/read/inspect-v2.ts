import {
  copyJson,
  type FindingSink,
  isRecord,
  type JsonValue,
  type Schema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import {
  type BadgeAssertionV2,
  CONTEXTS,
  type CredentialIssue,
  type CryptographicKeyV2,
  type EndorsementV2,
  type ProfileV2,
  type RevocationListV2,
} from "../model/index.js";
import { replaceAliasesV2 } from "./context-v2.js";
import { parseInto } from "./inspect.js";
import {
  type AssertionDocumentV2,
  assertionV2Schema,
  type BadgeClassDocumentV2,
  badgeClassV2Schema,
  cryptographicKeyV2Schema,
  embeddedDocument,
  endorsementV2Schema,
  profileV2Schema,
  revocationListV2Schema,
} from "./open-badges-v2-schemas.js";
import { assertionIssuesV2, badgeClassIssuesV2, issuerIssuesV2, revocationListIssuesV2 } from "./rules-v2.js";

/** The documents of a 2.0 badge that its assertion names by their IRIs, as a verifier fetched them. */
export interface LinkedDocumentsV2 {
  /** The BadgeClass, when the assertion does not embed it. */
  readonly badge?: unknown;
  /** The Profile of the issuer, when the BadgeClass does not embed it. */
  readonly issuer?: unknown;
}

/** Where the three documents of a badge are, for the paths of the findings. */
export interface PlacesV2 {
  /** The path of the assertion, the empty string for the value as a whole. */
  readonly assertion: string;
  /** The path of its BadgeClass. */
  readonly badge: string;
  /** The path of the profile of its issuer. */
  readonly issuer: string;
}

/** The places of the documents of an assertion that embeds them: the BadgeClass at `badge`, its issuer at `badge.issuer`. */
export const DOCUMENT_PLACES: PlacesV2 = { assertion: "", badge: "badge", issuer: "badge.issuer" };

/** The places of the documents of a `BadgeAssertionV2`. */
const MODEL_PLACES: PlacesV2 = { assertion: "assertion", badge: "badge", issuer: "issuer" };

/** What reading one document gives: the document when its shape is right, and the copy with the aliases replaced. */
interface ReadDocument<TDocument> {
  /** The document, when its shape is right. */
  readonly document: TDocument | undefined;
  /** The copy that was read, which the documents that it embeds are read from. */
  readonly copy: JsonValue | undefined;
}

/** Joins a place and a path below it, as `pathOf` of `core/checks` writes a path. */
function at(place: string, path: string): string {
  if (place === "") return path;
  if (path === "") return place;
  return path.startsWith("[") ? `${place}${path}` : `${place}.${path}`;
}

/**
 * Reads one document of Open Badges 2.0 at a place: copies it within the depth limit, replaces the aliases of the context,
 * parses it with the schema of its class and, when its shape is right, judges it with the rules of the class.
 */
function readDocument<TDocument>(
  schema: Schema<TDocument>,
  rules: (document: TDocument, place: string) => CredentialIssue[],
  value: unknown,
  place: string,
  sink: FindingSink<CredentialIssue>,
): ReadDocument<TDocument> {
  const copy = copyJson(value, place);
  if ("problem" in copy) {
    sink.add([{ path: place, rule: "invalid-value", message: `${copy.problem}.`, severity: "error" }]);
    return { document: undefined, copy: undefined };
  }
  const replaced = replaceAliasesV2(copy.value, place);
  sink.add(replaced.issues);
  return readPrepared(schema, rules, replaced.value, place, sink);
}

/**
 * Reads a document that is already a copy with its aliases replaced, such as one that a document read before embeds: parses it
 * with the schema of its class and, when its shape is right, judges it with the rules of the class.
 */
function readPrepared<TDocument>(
  schema: Schema<TDocument>,
  rules: (document: TDocument, place: string) => CredentialIssue[],
  copy: JsonValue,
  place: string,
  sink: FindingSink<CredentialIssue>,
): ReadDocument<TDocument> {
  const document = parseInto(
    schema,
    copy,
    sink.within((finding) => ({ ...finding, path: at(place, finding.path) })),
  );
  if (document !== undefined) sink.add(rules(document, place));
  return { document, copy };
}

/** The finding of a document that the assertion names by its IRI and that is neither embedded nor given. */
function notEmbedded(path: string, what: string): CredentialIssue {
  return {
    path,
    rule: "not-embedded",
    message: `is the IRI of the ${what}, which is not embedded: embed it, or verify the assertion, which fetches it.`,
    severity: "error",
  };
}

/** The finding of a document that is embedded and given apart as well. */
function givenTwice(path: string, what: string): CredentialIssue {
  return {
    path,
    rule: "unlinked-document",
    message: `is embedded, and the ${what} is given apart from it as well: give it once.`,
    severity: "error",
  };
}

/** The finding of a document whose `id` is not the IRI that names it. */
function otherDocument(path: string, id: string, named: string, what: string): CredentialIssue {
  return {
    path,
    rule: "unlinked-document",
    message: `is ${id}, and the ${what} is named by ${named}: give the ${what} that it names.`,
    severity: "error",
  };
}

/** A document that another names: embedded in the copy of that one, or given apart. */
type Linked = { readonly embedded: JsonValue } | { readonly given: unknown };

/**
 * Finds a document that another names: embedded in it, or given apart from it when it names it by its IRI.
 *
 * @returns The document, or `undefined` with a finding when it is missing or given twice.
 */
function linkedDocument(
  holder: JsonValue | undefined,
  property: string,
  given: unknown,
  path: string,
  what: string,
  sink: FindingSink<CredentialIssue>,
): Linked | undefined {
  const named = isRecord(holder) ? holder[property] : undefined;
  if (isRecord(named)) {
    if (given === undefined) return { embedded: named };
    sink.add([givenTwice(path, what)]);
    return undefined;
  }
  // A value that is neither an IRI nor a document was found by the schema of the holder.
  if (typeof named !== "string") return undefined;
  if (given !== undefined) return { given };
  sink.add([notEmbedded(path, what)]);
  return undefined;
}

/** Reads a document that another names: an embedded one as part of the copy of that one, a given one from the start. */
function readLinked<TDocument>(
  schema: Schema<TDocument>,
  rules: (document: TDocument, place: string) => CredentialIssue[],
  linked: Linked,
  place: string,
  sink: FindingSink<CredentialIssue>,
): ReadDocument<TDocument> {
  return "embedded" in linked
    ? readPrepared(schema, rules, linked.embedded, place, sink)
    : readDocument(schema, rules, linked.given, place, sink);
}

/**
 * Reads an Open Badges 2.0 assertion with its BadgeClass and the Profile of its issuer, each embedded in the document that
 * names it or given apart, and joins the three into a `BadgeAssertionV2`.
 *
 * @remarks
 * Each document is read at its place, with its own findings. A document given apart must have the `id` that names it. The
 * assertion and the BadgeClass of the result name the others by their `id`.
 *
 * @param assertion - The assertion, as parsed JSON.
 * @param linked - The documents that the assertion and its BadgeClass name by their IRIs.
 * @param places - Where the documents are, for the paths of the findings.
 * @param sink - Receives the findings.
 * @returns The badge, when each document has the shape of its class.
 */
export function inspectBadgeV2(
  assertion: unknown,
  linked: LinkedDocumentsV2,
  places: PlacesV2,
  sink: FindingSink<CredentialIssue>,
): BadgeAssertionV2 | undefined {
  const read = readDocument(assertionV2Schema, assertionIssuesV2, assertion, places.assertion, sink);
  const badgeValue = linkedDocument(
    read.copy,
    "badge",
    linked.badge,
    at(places.assertion, "badge"),
    "BadgeClass",
    sink,
  );
  if (badgeValue === undefined) return undefined;
  const badge = readLinked(badgeClassV2Schema, badgeClassIssuesV2, badgeValue, places.badge, sink);
  const issuerValue = linkedDocument(badge.copy, "issuer", linked.issuer, at(places.badge, "issuer"), "issuer", sink);
  if (issuerValue === undefined) return undefined;
  const issuer = readLinked(profileV2Schema, issuerIssuesV2, issuerValue, places.issuer, sink);
  if (read.document === undefined || badge.document === undefined || issuer.document === undefined) return undefined;
  const { badge: badgeRef, ...assertionMembers } = read.document;
  const { issuer: issuerRef, ...badgeMembers } = badge.document;
  if (typeof badgeRef === "string" && badgeRef !== badge.document.id) {
    sink.add([otherDocument(at(places.badge, "id"), badge.document.id, badgeRef, "BadgeClass")]);
  }
  if (typeof issuerRef === "string" && issuerRef !== issuer.document.id) {
    sink.add([otherDocument(at(places.issuer, "id"), issuer.document.id, issuerRef, "issuer")]);
  }
  return {
    version: "2.0",
    assertion: { ...assertionMembers, badge: badge.document.id },
    badge: { ...badgeMembers, issuer: issuer.document.id },
    issuer: issuer.document,
  };
}

/** The shape of a `BadgeAssertionV2`, whose documents are read each at its place. */
const badgeAssertionV2Schema = strictRecord({
  version: v.literal("2.0"),
  assertion: embeddedDocument,
  badge: embeddedDocument,
  issuer: embeddedDocument,
});

/**
 * Reads a `BadgeAssertionV2`: the three documents of a 2.0 badge, linked by their IRIs.
 *
 * @param value - The value, such as a badge that the package returned and a host stored as JSON.
 * @param sink - Receives the findings.
 * @returns The badge, when each document has the shape of its class.
 */
export function inspectBadgeAssertionV2(
  value: unknown,
  sink: FindingSink<CredentialIssue>,
): BadgeAssertionV2 | undefined {
  const parts = parseInto(badgeAssertionV2Schema, value, sink);
  if (parts === undefined) return undefined;
  return inspectBadgeV2(parts.assertion, { badge: parts.badge, issuer: parts.issuer }, MODEL_PLACES, sink);
}

/** Tells whether a value is a document of Open Badges 2.0: it names the context of Open Badges 2.0 as its only context. */
export function isDocumentV2(value: unknown): boolean {
  return isRecord(value) && value["@context"] === CONTEXTS.openBadgesV2;
}

/** Tells whether a value is meant as a `BadgeAssertionV2`: it has the version `2.0` and names no context. */
export function isBadgeAssertionV2(value: unknown): boolean {
  return isRecord(value) && value.version === "2.0" && !("@context" in value);
}

/** The documents of Open Badges 2.0 that a reader reads on their own, by the label of their class. */
interface DocumentsV2 {
  readonly assertion: AssertionDocumentV2;
  readonly "badge-class": BadgeClassDocumentV2;
  readonly profile: ProfileV2;
  readonly "cryptographic-key": CryptographicKeyV2;
  readonly endorsement: EndorsementV2;
  readonly "revocation-list": RevocationListV2;
}

/** The schema and the rules of each document that a reader reads on its own. */
const DOCUMENT_CLASSES: {
  readonly [TKind in keyof DocumentsV2]: {
    readonly schema: Schema<DocumentsV2[TKind]>;
    readonly rules: (document: DocumentsV2[TKind], place: string) => CredentialIssue[];
  };
} = {
  assertion: { schema: assertionV2Schema, rules: assertionIssuesV2 },
  "badge-class": { schema: badgeClassV2Schema, rules: badgeClassIssuesV2 },
  profile: { schema: profileV2Schema, rules: issuerIssuesV2 },
  "cryptographic-key": { schema: cryptographicKeyV2Schema, rules: () => [] },
  endorsement: { schema: endorsementV2Schema, rules: () => [] },
  "revocation-list": { schema: revocationListV2Schema, rules: revocationListIssuesV2 },
};

/**
 * Reads one document of Open Badges 2.0, such as one that a verifier fetched on its own: an assertion, a BadgeClass, the
 * profile of an issuer, a CryptographicKey, an Endorsement or a RevocationList. A document that it embeds is checked as a
 * value, and not read as a document of its own.
 *
 * @param kind - The class of the document.
 * @param value - The document, as parsed JSON.
 * @param sink - Receives the findings.
 * @returns The document, when its shape is right.
 */
export function inspectDocumentV2<TKind extends keyof DocumentsV2>(
  kind: TKind,
  value: unknown,
  sink: FindingSink<CredentialIssue>,
): DocumentsV2[TKind] | undefined {
  const { schema, rules } = DOCUMENT_CLASSES[kind];
  return readDocument(schema, rules, value, "", sink).document;
}
