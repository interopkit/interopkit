import { join } from "node:path";
import { isRecord } from "@interopkit/core/checks";
import { describe, expect, it } from "vitest";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import { CONTEXTS, readCredential, validateCredential } from "../src/index.js";
import { inspectDocumentV2, issueSink } from "../src/read/internal.js";

type Json = Readonly<Record<string, unknown>>;

const ROOT = join(import.meta.dirname, "../../..");
const MAIN = readSpecPage(ROOT, "open-badges-2p0.json").filter(isRecord);
const EXAMPLES = readSpecPage(ROOT, "open-badges-2p0-examples.json").filter(isRecord);

/** The label under which the reader reads a document of each class that the examples print. */
const KINDS = {
  Assertion: "assertion",
  BadgeClass: "badge-class",
  Issuer: "profile",
  Profile: "profile",
  CryptographicKey: "cryptographic-key",
  Endorsement: "endorsement",
  RevocationList: "revocation-list",
} as const;

/** The findings of one document, read as a document of the class that its type names, as `path rule`. */
function findingsOf(document: Json): readonly string[] {
  const kind = KINDS[document.type as keyof typeof KINDS];
  const sink = issueSink(1000, false);
  inspectDocumentV2(kind, document, sink);
  return sink.list().map(({ path, rule }) => `${path} ${rule}`);
}

const typed = EXAMPLES.filter((example) => typeof example.type === "string" && example.type in KINDS);
const fragments = EXAMPLES.filter((example) => example.type === undefined && "@context" in example);
/** The documents that say they are revoked and hold only what the specification then requires. */
const revoked = typed.filter((example) => example.revoked === true);

describe("the examples of the page of Open Badges 2.0", () => {
  const [first, endorsement] = MAIN;

  it("reads the first example, which embeds its BadgeClass and issuer, but for the hashed that its recipient lacks", () => {
    expect(validateCredential(first).map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "recipient.hashed missing-property",
    ]);
    const recipient = { ...(first?.recipient as Json), hashed: false };
    expect(readCredential({ ...first, recipient })).toMatchObject({
      version: "2.0",
      issuer: { name: "Example Maker Society" },
    });
  });

  it("reads the example of an endorsement", () => {
    expect(endorsement?.type).toBe("Endorsement");
    expect(findingsOf(endorsement ?? {})).toStrictEqual([]);
  });
});

describe("the page of examples of Open Badges 2.0", () => {
  it("prints documents of the classes that a verifier reads, the header of a JWS, and fragments that show a property each", () => {
    expect(new Set(typed.map((example) => example.type))).toStrictEqual(
      new Set(["Assertion", "Issuer", "CryptographicKey", "RevocationList", "Endorsement"]),
    );
    expect(
      fragments.every((example) => example["@context"] === CONTEXTS.openBadgesV2 && typeof example.id === "string"),
    ).toBe(true);
  });

  it.each(
    typed
      .filter((example) => example.revoked !== true)
      .map((example) => [`${example.type} ${example.id}`, example] as const),
  )("reads the %s", (_name, example) => {
    expect(findingsOf(example)).toStrictEqual([]);
  });

  it("refuses a revoked endorsement that holds only its id, issuer and revocation, as a document without its properties", () => {
    expect(revoked.map(findingsOf)).toStrictEqual([
      ["claim missing-property", "issuedOn missing-property", "verification missing-property"],
    ]);
  });

  it("reads each fragment within the hosted assertion of the page, whose id the fragments share", () => {
    const assertion = typed.find((example) => example.type === "Assertion" && example.id === fragments[0]?.id);
    if (assertion === undefined) throw new Error("The page has no assertion with the id of its fragments.");
    for (const fragment of fragments.filter((example) => example.id === assertion.id)) {
      expect(findingsOf({ ...assertion, ...fragment })).toStrictEqual([]);
    }
  });
});
