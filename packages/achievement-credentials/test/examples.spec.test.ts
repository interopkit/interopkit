import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import {
  buildAchievementCredential,
  buildClrCredential,
  CONTEXTS,
  type IssuableCredential,
  isSameCredential,
  readCredential,
  readEntity,
  selectNewerCredential,
  validateCredential,
  validateEntity,
} from "../src/index.js";

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

  it("are conformant credentials: they have no finding but one, of a result that names the wrong description", () => {
    const findings = credentials.flatMap((example) =>
      validateCredential(example).map(
        ({ path, rule, severity }) => `${String(example.id)} ${path} ${rule} ${severity}`,
      ),
    );
    // The complete example, which the page prints twice, links a result to its letter grade and gives it a level of the rubric
    // of another description.
    expect(new Set(findings)).toStrictEqual(
      new Set([
        "http://1edtech.edu/credentials/3732 credentialSubject.result[1].achievedLevel achieved-level-unknown warning",
      ]),
    );
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

describe("the equality and comparison examples of Open Badges 3.0", () => {
  const [a, b, c, d] = examplesOf("open-badges-3p0.json").filter((example) => example.name === "Teamwork Badge");
  /** Reads an example into a credential under the Verifiable Credentials Data Model 2.0, which the comparisons take. */
  const credential = (example: Example | undefined): IssuableCredential => {
    const read = readCredential(example ?? {});
    if (!("@context" in read) || "issuanceDate" in read) {
      throw new Error("The example is not under the Verifiable Credentials Data Model 2.0.");
    }
    return read;
  };

  it("holds the four credentials A, B, C and D of section 10.1", () => {
    expect([a, b, c, d].every((example) => example !== undefined && isCredential(example))).toBe(true);
  });

  it("calls A and B equal, since they have the same id and the same issuer id, and C and D equal for the same reason", () => {
    expect(isSameCredential(credential(a), credential(b))).toBe(true);
    expect(isSameCredential(credential(c), credential(d))).toBe(true);
    expect(isSameCredential(credential(a), credential(c))).toBe(true);
  });

  it("calls both up-to-date when the validFrom is the same, and C the up-to-date one of C and D, which has the more recent validFrom", () => {
    const [first, second, third, fourth] = [credential(a), credential(b), credential(c), credential(d)];
    expect(selectNewerCredential(first, second)).toBe(first);
    expect(selectNewerCredential(second, first)).toBe(second);
    expect(selectNewerCredential(third, fourth)).toBe(third);
    expect(selectNewerCredential(fourth, third)).toBe(third);
  });
});

describe("the builders against the credentials that the specifications print", () => {
  /** The properties of an AchievementCredential that `buildAchievementCredential` takes by the same name. */
  const SAME = [
    "id",
    "issuer",
    "validFrom",
    "validUntil",
    "name",
    "description",
    "image",
    "awardedDate",
    "evidence",
    "endorsement",
    "endorsementJwt",
    "credentialStatus",
    "refreshService",
    "termsOfUse",
  ];
  /** The properties of the subject that the input takes by the same name. */
  const SUBJECT = [
    "id",
    "identifier",
    "result",
    "activityStartDate",
    "activityEndDate",
    "creditsEarned",
    "role",
    "term",
  ];

  const OFFICIAL_SCHEMA =
    "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json";

  /** The AchievementCredentials of the page that a builder can write: the contexts and the one schema are the builder's own. */
  const buildable = examplesOf("open-badges-3p0.json").filter((example) => {
    const subject = example.credentialSubject as Example;
    const schemas = example.credentialSchema as Example[] | undefined;
    return (
      Array.isArray(example.type) &&
      example.type.includes("OpenBadgeCredential") &&
      Object.keys(example).every((key) =>
        [...SAME, "@context", "type", "credentialSubject", "credentialSchema"].includes(key),
      ) &&
      Object.keys(subject).every((key) => [...SUBJECT, "type", "achievement"].includes(key)) &&
      schemas?.length === 1 &&
      schemas[0]?.id === OFFICIAL_SCHEMA &&
      example.name !== undefined
    );
  });

  it("holds the credentials that the tests rebuild", () => {
    expect(buildable.length).toBeGreaterThanOrEqual(3);
  });

  it("write the credential of the page from its parts: the contexts, the types and the schema are the builder's", () => {
    for (const example of buildable) {
      const subject = example.credentialSubject as Example;
      const { type, achievement, ...rest } = subject;
      const input = {
        ...Object.fromEntries(SAME.filter((key) => key in example).map((key) => [key, example[key]])),
        subject: rest,
        achievement,
      };
      const built = buildAchievementCredential(input as never);
      // The credentials of the page leave out the context of the extensions, which defines the type of the schema.
      expect(built).toStrictEqual({
        ...example,
        "@context": [CONTEXTS.credentialsV2, CONTEXTS.openBadges, CONTEXTS.extensions],
      });
      expect(type).toStrictEqual(["AchievementSubject"]);
    }
  });

  it("write the ClrCredentials of CLR 2.0 from their parts: the contexts and the schema of the CLR are the builder's", () => {
    const KEYS = [
      "@context",
      "id",
      "type",
      "name",
      "issuer",
      "validFrom",
      "validUntil",
      "credentialSubject",
      "partial",
      "credentialStatus",
      "refreshService",
      "credentialSchema",
    ];
    const SUBJECT_KEYS = ["id", "identifier", "type", "verifiableCredential", "achievement", "association"];
    const listed = examplesOf("clr-2p0.json").filter(
      (example) =>
        Object.keys(example).every((key) => KEYS.includes(key)) &&
        Object.keys(example.credentialSubject as Example).every((key) => SUBJECT_KEYS.includes(key)),
    );
    expect(listed.length).toBeGreaterThanOrEqual(2);
    for (const example of listed) {
      const { type, verifiableCredential, achievement, association, ...rest } = example.credentialSubject as Example;
      const { credentialSubject, credentialSchema, "@context": contexts, type: types, ...top } = example;
      const built = buildClrCredential({
        ...top,
        subject: rest,
        credentials: verifiableCredential,
        ...(achievement === undefined ? {} : { achievements: achievement }),
        ...(association === undefined ? {} : { associations: association }),
      } as never);
      // The pages print the schema of an AchievementCredential in a ClrCredential; the CLR's own is what 7.2 asks for.
      expect(built).toMatchObject({
        "@context": [CONTEXTS.credentialsV2, CONTEXTS.clr, CONTEXTS.openBadges, CONTEXTS.extensions],
        id: example.id,
        type: example.type,
        name: example.name,
        validFrom: example.validFrom,
        credentialSubject: { type: ["ClrSubject"], ...rest },
        credentialSchema: [
          {
            id: "https://purl.imsglobal.org/spec/clr/v2p0/schema/json/clr_v2p0_clrcredential_schema.json",
            type: "1EdTechJsonSchemaValidator2019",
          },
        ],
      });
      expect(built.credentialSubject.verifiableCredential.map(({ id }) => id)).toStrictEqual(
        (verifiableCredential as Example[]).map(({ id }) => id),
      );
      expect(built.credentialSubject.association).toStrictEqual(association);
      expect(built.credentialSubject.achievement).toStrictEqual(achievement);
      expect(type).toStrictEqual(["ClrSubject"]);
      expect(credentialSchema).toHaveLength(1);
      expect([contexts, types].every(Array.isArray)).toBe(true);
    }
  });
});
