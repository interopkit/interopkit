import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import { readCredential, readEntity, validateCredential, validateEntity } from "../src/index.js";

const ROOT = resolve(import.meta.dirname, "../../..");

type Example = Record<string, unknown>;

function isExample(value: unknown): value is Example {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The examples that a page prints: the JSON objects that have a context and a type, in the order of the page. */
function examplesOf(page: string): Example[] {
  return readSpecPage(ROOT, page).filter(
    (block): block is Example => isExample(block) && "@context" in block && "type" in block,
  );
}

/** Whether an example is a credential: its types include `VerifiableCredential`. */
function isCredential(example: Example): boolean {
  return Array.isArray(example.type) && example.type.includes("VerifiableCredential");
}

describe("the examples of Open Badges 3.0", () => {
  const examples = examplesOf("open-badges-3p0.json");
  const credentials = examples.filter(isCredential);

  it("holds the credentials and the profile that the tests read", () => {
    expect(credentials).toHaveLength(20);
    expect(examples.filter((example) => !isCredential(example))).toHaveLength(1);
  });

  it("are conformant credentials: they have no finding", () => {
    for (const example of credentials) expect(validateCredential(example)).toStrictEqual([]);
  });

  it("are read into the model, a credential that names one type or many alike", () => {
    for (const example of credentials) expect(readCredential(example)).toMatchObject({ id: example.id });
  });

  it("holds a profile that is read as a Profile and not as a credential", () => {
    const [profile] = examples.filter((example) => !isCredential(example));
    expect(validateEntity("Profile", profile)).toStrictEqual([]);
    expect(readEntity("Profile", profile)).toMatchObject({ id: profile?.id });
    expect(validateCredential(profile).map(({ rule }) => rule)).toContain("missing-property");
  });
});

describe("the examples of CLR 2.0", () => {
  const credentials = examplesOf("clr-2p0.json").filter(isCredential);

  it("holds the ClrCredentials that the tests read", () => {
    expect(credentials).toHaveLength(10);
  });

  it("are conformant: they have no finding", () => {
    for (const example of credentials) expect(validateCredential(example)).toStrictEqual([]);
  });

  it("are read as the kind that their type names", () => {
    for (const example of credentials) {
      expect(readCredential(example)).toStrictEqual(readCredential(example, { kind: "ClrCredential" }));
    }
  });
});
