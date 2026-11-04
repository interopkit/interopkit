import { readFileSync } from "node:fs";
import { DataError } from "@interopkit/core";
import type { Issue } from "@interopkit/core/checks";
import { describe, expect, it } from "vitest";
import {
  type Json,
  OB2_ACCEPTANCES,
  OB2_REFUSALS,
  type Ob2Rule,
  type RuleDocument,
  soundAssertion,
  soundEndorsement,
  soundKey,
  soundRevocationList,
} from "../../../scripts/open-badges-v2-rules.js";
import {
  type AnyCredential,
  type BadgeAssertionV2,
  CONTEXTS,
  matchesIdentifier,
  readCredential,
  summarizeCredential,
  validateCredential,
} from "../src/index.js";
import {
  DOCUMENT_PLACES,
  inspectBadgeV2,
  inspectDocumentV2,
  issueSink,
  parseDateTimeV2,
  readJwsPayload,
} from "../src/read/internal.js";

/** A resource that the fixture server of the verifier answers with. */
interface Served {
  readonly status: number;
  readonly body: unknown;
}

/** A case of the fixture: what a verifier is given, and what a JWS signs. */
interface Case {
  readonly name: string;
  readonly verification: "hosted" | "signed";
  readonly outcome: string;
  readonly input: unknown;
  readonly payload?: Json;
}

/** The badges that `validation/ob2_badges.py` writes. */
interface Fixture {
  readonly now: string;
  readonly recipient: { readonly type: string; readonly value: string };
  readonly documents: Readonly<Record<string, Served>>;
  readonly cases: readonly Case[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL("./fixtures/open-badges-2/badges.json", import.meta.url), "utf8"),
);
const DOCUMENTS = fixture.documents;
const CASES = fixture.cases;

/** The sound document of each kind that the rules change. */
const SOUND: Readonly<Record<RuleDocument, () => Json>> = {
  assertion: soundAssertion,
  "cryptographic-key": soundKey,
  endorsement: soundEndorsement,
  "revocation-list": soundRevocationList,
};

/** The findings of a document of a rule, as `path rule severity`, from the reader of its kind. */
function findingsOf(document: RuleDocument, value: Json): readonly string[] {
  let findings: readonly Issue[];
  if (document === "assertion") {
    findings = validateCredential(value);
  } else {
    const sink = issueSink(1000, false);
    inspectDocumentV2(document, value, sink);
    findings = sink.list();
  }
  return findings.map(({ path, rule, severity }) => `${path} ${rule} ${severity}`);
}

/** The body that the fixture server answers at an address. */
function served(url: string): unknown {
  const resource = DOCUMENTS[url];
  if (resource === undefined) throw new Error(`The fixture has no document at ${url}.`);
  return resource.body;
}

/** Reads a hosted assertion of the fixture with the BadgeClass and issuer that it names, as a verifier would fetch them. */
function readHosted(assertion: Json): BadgeAssertionV2 {
  const badgeValue = assertion.badge;
  const badge = typeof badgeValue === "string" ? served(badgeValue) : badgeValue;
  const issuerValue = (badge as Json).issuer;
  const issuer = typeof issuerValue === "string" ? served(issuerValue) : issuerValue;
  if (typeof badgeValue !== "string") return asV2(readCredential(assertion));
  return asV2(readCredential({ version: "2.0", assertion, badge, issuer }));
}

/** Narrows a credential that the test knows is a 2.0 badge. */
function asV2(credential: AnyCredential): BadgeAssertionV2 {
  if ("@context" in credential) throw new Error("The value was read as a verifiable credential.");
  return credential;
}

describe("the rules of Open Badges 2.0", () => {
  it.each(OB2_REFUSALS.map((rule) => [`${rule.source}: ${rule.text}`, rule] as const))(
    "finds what the specification asks: %s",
    (_name: string, rule: Ob2Rule) => {
      const value = rule.fixture(SOUND[rule.document]());
      const expected = rule.findings.map(({ path, rule: name, severity }) => `${path} ${name} ${severity}`);
      expect(findingsOf(rule.document, value)).toStrictEqual(expected);
      if (rule.document !== "assertion") return;
      if (rule.findings.some(({ severity }) => severity === "error"))
        expect(() => readCredential(value)).toThrow(DataError);
      else expect(() => readCredential(value)).not.toThrow();
    },
  );

  it.each(OB2_ACCEPTANCES.map((rule) => [`${rule.source}: ${rule.text}`, rule] as const))(
    "accepts what the specification allows: %s",
    (_name, rule) => {
      const value = rule.fixture(SOUND[rule.document]());
      expect(findingsOf(rule.document, value)).toStrictEqual([]);
      if (rule.document === "assertion") expect(() => readCredential(value)).not.toThrow();
    },
  );

  it("accepts the sound documents that the rules change", () => {
    for (const document of Object.keys(SOUND) as RuleDocument[]) {
      expect(findingsOf(document, SOUND[document]())).toStrictEqual([]);
    }
  });
});

describe("reading an assertion that embeds its BadgeClass and issuer", () => {
  it("returns the three documents, each naming the next by its id, and shares nothing with the input", () => {
    const input = soundAssertion();
    const badge = asV2(readCredential(input));
    const { badge: embeddedBadge, ...assertion } = input;
    const { issuer: embeddedIssuer, ...badgeClass } = embeddedBadge as Json;
    expect(badge).toStrictEqual({
      version: "2.0",
      assertion: {
        ...assertion,
        badge: "https://example.org/badges/5",
        verification: { type: ["HostedBadge"] },
        type: ["Assertion"],
      },
      badge: { ...badgeClass, issuer: "https://example.org/issuer", type: ["BadgeClass"] },
      issuer: { ...(embeddedIssuer as Json), type: ["Profile"], verification: { allowedOrigins: ["example.org"] } },
    });
    expect(badge.assertion.recipient).not.toBe(input.recipient);
  });

  it("writes the aliases verify, hosted and signed as the terms they stand for", () => {
    const { verification: _verification, ...rest } = soundAssertion();
    const badge = asV2(readCredential({ ...rest, verify: { type: "signed", creator: "https://example.org/key" } }));
    expect(badge.assertion.verification).toStrictEqual({ type: ["SignedBadge"], creator: "https://example.org/key" });
    expect("verify" in badge.assertion).toBe(false);
  });

  it("names an alias given twice by the path of the input, in brackets where a name is no identifier", () => {
    const twice = { verify: { type: "hosted" }, verification: { type: "hosted" } };
    const findings = validateCredential({ ...soundAssertion(), "schema:about": twice });
    expect(findings.map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      '["schema:about"].verify duplicate-term',
    ]);
  });

  it("keeps an extension, which names its own context, as it is, aliases and all", () => {
    const extension = { "@context": "https://example.org/context.json", type: ["Extension", "hosted"], verify: 5 };
    const input = { ...soundAssertion(), "extensions:ExampleExtension": extension };
    expect(asV2(readCredential(input)).assertion).toMatchObject({ "extensions:ExampleExtension": extension });
  });

  it("reads a value under the context of Open Badges 2.0 as a 3.0 credential when the caller asks for a kind", () => {
    expect(() => readCredential(soundAssertion(), { kind: "AchievementCredential" })).toThrow(
      'The credential is invalid at ["@context"]: expected an array, found "https://w3id.org/openbadges/v2".',
    );
  });

  it("reads a document under another context as a 3.0 credential, and one whose contexts hold that of 2.0 as 2.0", () => {
    const old = { ...soundAssertion(), "@context": "https://w3id.org/openbadges/v1" };
    expect(validateCredential(old)[0]).toMatchObject({ path: '["@context"]', rule: "wrong-type" });
    const extended = { ...soundAssertion(), "@context": [CONTEXTS.openBadgesV2, "https://example.org/context.json"] };
    expect(asV2(readCredential(extended)).assertion["@context"]).toStrictEqual(extended["@context"]);
  });

  it("refuses a value that is not JSON, or nests too deep, as a finding at the document", () => {
    const deep = { ...soundAssertion(), narrative: JSON.parse(`${"[".repeat(70)}${"]".repeat(70)}`) };
    expect(validateCredential(deep).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([" invalid-value"]);
    const getter = {
      ...soundAssertion(),
      badge: {
        get name() {
          return "x";
        },
      },
    };
    expect(validateCredential(getter).map(({ rule }) => rule)).toContain("missing-property");
  });

  it("lists at most the limit of findings, and ends the list with one that says it stopped", () => {
    const tags = Array.from({ length: 100_000 }, () => 0);
    const value = { ...soundAssertion(), badge: { ...(soundAssertion().badge as Json), tags } };
    const findings = validateCredential(value);
    expect(findings).toHaveLength(1001);
    expect(findings.at(-1)).toMatchObject({ rule: "findings-stopped" });
    expect(validateCredential(value, { maxFindings: 3 })).toHaveLength(4);
    expect(() => readCredential(value, { maxFindings: 2 })).toThrow("the check stopped at its limit");
  });
});

describe("reading a BadgeAssertionV2", () => {
  const documents = () => {
    const badge = asV2(readCredential(soundAssertion()));
    return { version: "2.0", assertion: badge.assertion, badge: badge.badge, issuer: badge.issuer } as Json;
  };

  it("reads what it returned, and its JSON, into an equal badge", () => {
    const badge = readCredential(soundAssertion());
    expect(readCredential(badge)).toStrictEqual(badge);
    expect(readCredential(JSON.parse(JSON.stringify(badge)))).toStrictEqual(badge);
  });

  it("reads the three documents as a server hosts them, each with its context", () => {
    const { assertion, badge, issuer } = documents() as { assertion: Json; badge: Json; issuer: Json };
    const hosted = {
      version: "2.0",
      assertion: { ...assertion, "@context": CONTEXTS.openBadgesV2 },
      badge: { ...badge, "@context": CONTEXTS.openBadgesV2 },
      issuer: { ...issuer, "@context": CONTEXTS.openBadgesV2 },
    };
    expect(asV2(readCredential(hosted)).assertion["@context"]).toBe(CONTEXTS.openBadgesV2);
  });

  it("refuses a BadgeClass or a profile whose id is not the IRI that names it", () => {
    const value = documents();
    const other = { ...value, badge: { ...(value.badge as Json), id: "https://example.org/badges/6" } };
    expect(validateCredential(other)).toStrictEqual([
      {
        path: "badge.id",
        rule: "unlinked-document",
        message:
          "is https://example.org/badges/6, and the BadgeClass is named by https://example.org/badges/5: give the BadgeClass that it names.",
        severity: "error",
      },
    ]);
    const issuer = { ...value, issuer: { ...(value.issuer as Json), id: "https://example.org/other" } };
    expect(validateCredential(issuer).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "issuer.id unlinked-document",
    ]);
  });

  it("refuses a BadgeClass that the assertion embeds and that is given apart as well", () => {
    const value = { ...documents(), assertion: soundAssertion() };
    expect(validateCredential(value).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "assertion.badge unlinked-document",
    ]);
  });

  it("refuses a value without one of the three documents, or with a property it does not have", () => {
    const { issuer: _issuer, ...rest } = documents();
    expect(validateCredential(rest).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "issuer missing-property",
    ]);
    expect(validateCredential({ ...documents(), extra: 1 }).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "extra unknown-property",
    ]);
    expect(validateCredential({ ...documents(), badge: "https://example.org/badges/5" })[0]).toMatchObject({
      path: "badge",
      rule: "wrong-type",
    });
  });

  it("names the place of a finding in each document", () => {
    const value = documents();
    const broken = {
      ...value,
      assertion: { ...(value.assertion as Json), issuedOn: "yesterday" },
      issuer: { ...(value.issuer as Json), email: "contact" },
    };
    expect(validateCredential(broken).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "assertion.issuedOn invalid-format",
      "issuer.email invalid-format",
    ]);
  });
});

describe("reading an assertion with the documents that a verifier fetched", () => {
  const documents = (): { readonly assertion: Json; readonly badge: Json; readonly issuer: Json } => {
    const { badge, ...assertion } = soundAssertion();
    const { issuer, ...badgeClass } = badge as Json;
    return {
      assertion: { ...assertion, badge: (badge as Json).id },
      badge: { ...badgeClass, "@context": CONTEXTS.openBadgesV2, issuer: (issuer as Json).id },
      issuer: { ...(issuer as Json), "@context": CONTEXTS.openBadgesV2 },
    };
  };
  const read = (assertion: unknown, linked: { readonly badge?: unknown; readonly issuer?: unknown }) => {
    const sink = issueSink(1000, false);
    const badge = inspectBadgeV2(assertion, linked, DOCUMENT_PLACES, sink);
    return { badge, findings: sink.list().map(({ path, rule }) => `${path} ${rule}`) };
  };

  it("joins the assertion with the BadgeClass and the issuer given apart, each read with its aliases", () => {
    const { assertion, badge, issuer } = documents();
    const { verification: _verification, ...rest } = assertion;
    const joined = read({ ...rest, verify: { type: "hosted" } }, { badge, issuer });
    expect(joined.findings).toStrictEqual([]);
    expect(joined.badge?.assertion.verification).toStrictEqual({ type: ["HostedBadge"] });
    expect(joined.badge?.issuer["@context"]).toBe(CONTEXTS.openBadgesV2);
  });

  it("names the place of a document given apart that is not an object, or that is missing", () => {
    const { assertion, badge } = documents();
    expect(read(assertion, { badge: [badge] }).findings).toStrictEqual(["badge wrong-type"]);
    expect(read(assertion, { badge }).findings).toStrictEqual(["badge.issuer not-embedded"]);
  });
});

describe("the badges that a script writes with jwcrypto", () => {
  const hosted = CASES.filter((badge) => badge.verification === "hosted" && typeof badge.input === "object");
  const signed = CASES.filter((badge) => badge.verification === "signed");

  it("holds hosted and signed badges of every outcome", () => {
    expect(new Set(CASES.map((badge) => badge.outcome))).toStrictEqual(
      new Set(["valid", "revoked", "expired", "outside-policy", "bad-signature", "unlisted-key"]),
    );
  });

  it.each(hosted.map((badge) => [badge.name, badge] as const))("reads %s", (_name, badge) => {
    const read = readHosted(badge.input as Json);
    expect(read.assertion.id).toBe((badge.input as Json).id);
    expect(matchesIdentifier(read.assertion.recipient, fixture.recipient)).toBe(true);
    expect(matchesIdentifier(read.assertion.recipient, { ...fixture.recipient, value: "other@example.org" })).toBe(
      false,
    );
  });

  it.each(signed.map((badge) => [badge.name, badge] as const))("reads the payload of %s", (_name, badge) => {
    const payload = readJwsPayload(badge.input as string, 1_000_000);
    expect(payload).toStrictEqual({ value: badge.payload });
    if (!("value" in payload)) return;
    const read = readHosted(payload.value);
    expect(read.assertion.verification.type).toStrictEqual(["SignedBadge"]);
    expect(matchesIdentifier(read.assertion.recipient, fixture.recipient)).toBe(true);
  });

  it("reads the documents that a verifier fetches: the keys and the revocation list", () => {
    for (const body of Object.values(DOCUMENTS).map((resource) => resource.body)) {
      const type = (body as Json | null)?.type;
      const sink = issueSink(1000, false);
      if (type === "CryptographicKey") expect(inspectDocumentV2("cryptographic-key", body, sink)).toBeDefined();
      if (type === "RevocationList") expect(inspectDocumentV2("revocation-list", body, sink)).toBeDefined();
      expect(sink.list()).toStrictEqual([]);
    }
  });

  it("reads the dates of every assertion, and tells the expired one by the instant that the fixture calls now", () => {
    const now = parseDateTimeV2(fixture.now);
    const expired = CASES.filter(
      (badge) => typeof badge.input === "object" && (badge.input as Json).expires !== undefined,
    )
      .filter((badge) => (parseDateTimeV2((badge.input as Json).expires as string) ?? 0) < (now ?? 0))
      .map((badge) => badge.outcome);
    expect(expired).toStrictEqual(["expired"]);
  });

  it("summarizes a badge by its BadgeClass, the issuer and the dates of the assertion", () => {
    const [badge] = hosted;
    if (badge === undefined) throw new Error("The fixture has no hosted badge.");
    const read = readHosted(badge.input as Json);
    expect(summarizeCredential(read)).toStrictEqual({
      kind: "badge-v2",
      name: "3-D Printmaster",
      description: "Awarded for passing the 3-D printing knowledge and safety test.",
      image: "https://badges.example.org/badges/printmaster/image",
      issuerName: "Example Maker Society",
      issuer: "https://badges.example.org/issuer",
      validFrom: "2025-11-02T09:00:00+00:00",
      validUntil: "2027-11-02T09:00:00Z",
    });
  });
});

describe("summarizeCredential of an Open Badges 2.0 assertion", () => {
  it("shows the image of the assertion before that of its BadgeClass, and the address of an image document", () => {
    const value = { ...soundAssertion(), image: { id: "https://example.org/assertions/123/image", caption: "Baked" } };
    expect(summarizeCredential(readCredential(value))).toMatchObject({
      image: "https://example.org/assertions/123/image",
    });
    expect(summarizeCredential(readCredential(soundAssertion()))).toStrictEqual({
      kind: "badge-v2",
      name: "3-D Printmaster",
      description: "This badge is awarded for passing the 3-D printing knowledge and safety test.",
      image: "https://example.org/badges/5/image",
      issuerName: "Example Maker Society",
      issuer: "https://example.org/issuer",
      validFrom: "2016-12-31T23:59:59+00:00",
    });
  });

  it("refuses a 2.0 value with an error, as readCredential does", () => {
    expect(() => summarizeCredential(JSON.parse(JSON.stringify({ ...soundAssertion(), issuedOn: 5 })))).toThrow(
      DataError,
    );
  });
});

describe("parseDateTimeV2", () => {
  it("reads the forms of ISO 8601 that Open Badges 2.0 describes into the same instant as RFC 3339", () => {
    const instant = Date.parse("2016-12-31T23:59:00Z");
    for (const text of [
      "2016-12-31T23:59Z",
      "2016-12-31T23:59:00Z",
      "2016-12-31T23:59:00.000+00:00",
      "2017-01-01T00:59+01",
      "2017-01-01T00:59:00+0100",
    ]) {
      expect(parseDateTimeV2(text)).toBe(instant);
    }
  });

  it("refuses a date and time without a zone, with a space, a lower-case z, or a day that does not exist", () => {
    for (const text of [
      "2016-12-31T23:59:00",
      "2016-12-31 23:59:00Z",
      "2016-12-31T23:59:00z",
      "2017-02-29T00:00Z",
      "2016-12-31T24:00Z",
      "20161231T235900Z",
    ]) {
      expect(parseDateTimeV2(text)).toBeUndefined();
    }
  });
});

describe("readJwsPayload", () => {
  const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");
  const jws = (payload: string) => `${encode('{"alg":"RS256"}')}.${payload}.c2ln`;

  it("reads the payload as a JSON object without checking the signature", () => {
    expect(readJwsPayload(jws(encode('{"id":"urn:uuid:1"}')), 10)).toStrictEqual({ value: { id: "urn:uuid:1" } });
  });

  it("refuses a JWS that is not compact, a detached payload, and base64url that is not canonical", () => {
    expect(readJwsPayload("a.b", 10)).toStrictEqual({
      reason: "The JWS is not a compact JWS of three parts of base64url characters.",
    });
    expect(readJwsPayload(jws(""), 10)).toStrictEqual({
      reason: "The JWS has a detached payload, which holds no assertion.",
    });
    // "e30" is the canonical "{}", and "e31" holds a bit that no byte has.
    expect(readJwsPayload(jws("e31"), 10)).toStrictEqual({
      reason: "The payload of the JWS is not canonical base64url without padding.",
    });
    expect(readJwsPayload(jws("e"), 10)).toStrictEqual({
      reason: "The payload of the JWS is not canonical base64url without padding.",
    });
  });

  it("refuses a payload that is not UTF-8, not JSON or not an object", () => {
    expect(readJwsPayload(jws(Buffer.from([0xff, 0xfe]).toString("base64url")), 10)).toStrictEqual({
      reason: "The payload of the JWS is not UTF-8.",
    });
    expect(readJwsPayload(jws(encode("{")), 10)).toStrictEqual({ reason: "The payload of the JWS is not JSON." });
    expect(readJwsPayload(jws(encode("[1]")), 10)).toStrictEqual({
      reason: "The payload of the JWS is not a JSON object.",
    });
  });

  it("counts the tokens and the levels of the payload before it parses it", () => {
    expect(readJwsPayload(jws(encode('{"a":[1,2]}')), 9)).toStrictEqual({ value: { a: [1, 2] } });
    expect(readJwsPayload(jws(encode('{"a":[1,2,3]}')), 9)).toStrictEqual({
      reason: "The payload of the JWS has more than the 9 tokens of JSON that it may have.",
    });
    expect(readJwsPayload(jws(encode(`{"a":${"[".repeat(64)}${"]".repeat(64)}}`)), 1000)).toStrictEqual({
      reason: "The payload of the JWS nests more than 64 levels.",
    });
  });
});
