import { isRecord, type JsonValue } from "@interopkit/core/checks";
import { CONTEXTS, type CredentialIssue } from "../model/index.js";

/**
 * The terms of the context of Open Badges 2.0 (`https://w3id.org/openbadges/v2`), in its order. The reader takes a document
 * in the compacted form of that context and needs no JSON-LD processor: this list, `PREFIXES_V2` and `ALIASES_V2` are what
 * it knows of the context, and a test compares them with the context at its pinned hash.
 */
export const TERMS_V2: ReadonlySet<string> = new Set([
  "id",
  "type",
  "extensions",
  "obi",
  "validation",
  "cred",
  "dc",
  "schema",
  "sec",
  "xsd",
  "AlignmentObject",
  "CryptographicKey",
  "Endorsement",
  "Assertion",
  "BadgeClass",
  "Criteria",
  "Evidence",
  "Extension",
  "FrameValidation",
  "IdentityObject",
  "Image",
  "HostedBadge",
  "hosted",
  "Issuer",
  "Profile",
  "RevocationList",
  "SignedBadge",
  "signed",
  "TypeValidation",
  "VerificationObject",
  "author",
  "caption",
  "claim",
  "created",
  "creator",
  "description",
  "email",
  "endorsement",
  "expires",
  "genre",
  "image",
  "name",
  "owner",
  "publicKey",
  "publicKeyPem",
  "related",
  "startsWith",
  "tags",
  "targetDescription",
  "targetFramework",
  "targetName",
  "targetUrl",
  "telephone",
  "url",
  "version",
  "alignment",
  "allowedOrigins",
  "audience",
  "badge",
  "criteria",
  "endorsementComment",
  "evidence",
  "hashed",
  "identity",
  "issuedOn",
  "issuer",
  "narrative",
  "recipient",
  "revocationList",
  "revocationReason",
  "revoked",
  "revokedAssertions",
  "salt",
  "targetCode",
  "uid",
  "validatesType",
  "validationFrame",
  "validationSchema",
  "verification",
  "verificationProperty",
  "verify",
]);

/** The terms of the context that alias a keyword of JSON-LD (`@id` and `@type`) and so name no IRI. */
export const KEYWORD_TERMS_V2: ReadonlySet<string> = new Set(["id", "type"]);

/** The terms of the context that are prefixes of compact IRIs, such as `schema:` in `schema:ImageObject`. */
export const PREFIXES_V2: ReadonlySet<string> = new Set(["extensions", "obi", "cred", "dc", "schema", "sec", "xsd"]);

/**
 * The terms of the context that stand for another of its terms: `verify` is the property `verification`, and `hosted` and
 * `signed` are the classes `HostedBadge` and `SignedBadge`. The reader writes each as the term it stands for.
 */
export const ALIASES_V2: ReadonlyMap<string, string> = new Map([
  ["verify", "verification"],
  ["hosted", "HostedBadge"],
  ["signed", "SignedBadge"],
]);

/** Tells whether a term of the context names a class: the classes of the vocabulary start with a capital. */
function isClassTerm(term: string): boolean {
  return /^[A-Z]/u.test(term);
}

/** The aliases that name a property, by alias. */
const PROPERTY_ALIASES: ReadonlyMap<string, string> = new Map([...ALIASES_V2].filter(([, term]) => !isClassTerm(term)));

/** The aliases that name a class, as a value of `type`, by alias. */
const CLASS_ALIASES: ReadonlyMap<string, string> = new Map([...ALIASES_V2].filter(([, term]) => isClassTerm(term)));

/** A name that a path writes after a dot; another is written in brackets, as `pathOf` of `core/checks` does. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

/** Joins a path and the name of a member, as `pathOf` of `core/checks` writes it. */
function memberPath(path: string, name: string): string {
  if (!IDENTIFIER.test(name)) return `${path}[${JSON.stringify(name)}]`;
  return path === "" ? name : `${path}.${name}`;
}

/** Writes a class that a value of `type` names as the term that it stands for, when it is an alias. */
function classTerm(value: JsonValue): JsonValue {
  return typeof value === "string" ? (CLASS_ALIASES.get(value) ?? value) : value;
}

/** What `replaceAliasesV2` returns: the document with the terms in place of the aliases, and the findings of its terms. */
export interface ReplacedAliases {
  /** The document. An object that names a context of its own is the object of the input, and every other one is new. */
  readonly value: JsonValue;
  /** A finding for each property held under an alias and its term, each name that no term defines, and each redefined term. */
  readonly issues: readonly CredentialIssue[];
}

/**
 * Tells whether a context is that of Open Badges 2.0, alone or in a list with others. A JSON-LD processor reads a document whose
 * contexts hold it by the terms of Open Badges 2.0, as the validator of 1EdTech does when it compacts a document into them.
 *
 * @param context - The `@context` of a document.
 */
export function holdsContextV2(context: unknown): boolean {
  return context === CONTEXTS.openBadgesV2 || (Array.isArray(context) && context.includes(CONTEXTS.openBadgesV2));
}

/** Tells whether a name is one that the context of Open Badges 2.0 gives a meaning: a term, or a compact or absolute IRI. */
function isKnownName(name: string): boolean {
  return TERMS_V2.has(name) || name.includes(":");
}

/**
 * Finds the terms of Open Badges 2.0 that a context in a list redefines after the context of 2.0: a processor reads such a term by
 * the later context, and the reader, which reads by the fixed table, would read it otherwise.
 */
function* redefinitions(context: JsonValue, path: string): Generator<CredentialIssue> {
  if (!Array.isArray(context)) return;
  const start = context.indexOf(CONTEXTS.openBadgesV2);
  for (const [index, entry] of context.entries()) {
    if (index < start || !isRecord(entry)) continue;
    for (const term of Object.keys(entry).filter((name) => TERMS_V2.has(name))) {
      yield {
        path: memberPath(`${memberPath(path, "@context")}[${index}]`, term),
        rule: "redefined-term",
        message: `redefines ${term}, a term of the context of Open Badges 2.0, which the reader reads only as that context defines it.`,
        severity: "error",
      };
    }
  }
}

/** Writes a value with the aliases replaced, and adds the findings of its terms. */
function replaceIn(node: JsonValue, path: string, issues: CredentialIssue[]): JsonValue {
  if (Array.isArray(node)) return node.map((item, index) => replaceIn(item, `${path}[${index}]`, issues));
  if (!isRecord(node)) return node;
  const context = node["@context"];
  if (context !== undefined && !holdsContextV2(context)) return node;
  if (context !== undefined) issues.push(...redefinitions(context, path));
  const members = Object.entries(node).map(([name, member]) => replaceMember(node, name, member, path, issues));
  // `Object.fromEntries` defines each member, so that a member named `__proto__` stays a member.
  return Object.fromEntries(members);
}

/** Writes one member of an object: under the term of its name when the name is an alias, with its value replaced. */
function replaceMember(
  node: Readonly<Record<string, JsonValue>>,
  name: string,
  member: JsonValue,
  path: string,
  issues: CredentialIssue[],
): [string, JsonValue] {
  if (name === "type") return [name, Array.isArray(member) ? member.map(classTerm) : classTerm(member)];
  // A keyword, such as `@context` or `@language`, holds no terms of the document.
  if (name.startsWith("@")) return [name, member];
  if (!isKnownName(name)) {
    issues.push({
      path: memberPath(path, name),
      rule: "unknown-term",
      message:
        "is not a term of the context of Open Badges 2.0, so it is no part of the meaning of the document: the reader keeps it as JSON.",
      severity: "warning",
    });
    return [name, member];
  }
  const term = PROPERTY_ALIASES.get(name) ?? name;
  if (term !== name && Object.hasOwn(node, term)) {
    issues.push({
      path: memberPath(path, name),
      rule: "duplicate-term",
      message: `is an alias of ${term}, which the object also holds: the context reads them as one property, so keep one of them.`,
      severity: "error",
    });
    return [name, member];
  }
  return [term, replaceIn(member, memberPath(path, term), issues)];
}

/**
 * Writes a copy of a document with the aliases of the context of Open Badges 2.0 replaced by the terms they stand for: the
 * property `verify` as `verification`, and `hosted` and `signed` in a `type` as `HostedBadge` and `SignedBadge`.
 *
 * @remarks
 * An object that names contexts of its own that do not hold that of Open Badges 2.0, such as an extension, is kept as it is with
 * what it holds, since its contexts may give the names other meanings. An object that holds a property under both an alias and
 * its term keeps both, with a finding, since the context reads them as one property with two values. A member whose name the
 * context does not define is kept with a warning, and so is what it holds; a context in a list that redefines a term of Open
 * Badges 2.0 after it is an error.
 *
 * @param value - The document, as JSON.
 * @param path - Where the document is, for the findings.
 * @returns The document and the findings.
 */
export function replaceAliasesV2(value: JsonValue, path: string): ReplacedAliases {
  const issues: CredentialIssue[] = [];
  return { value: replaceIn(value, path, issues), issues };
}
