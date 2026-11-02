import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { TERMS_V2, V2_SCHEMAS } from "../src/read/internal.js";
import { heldClass } from "./official.js";

const SCHEMAS = requireSchemas(join(import.meta.dirname, "../../.."));
/** A file of `openbadges-validator-core` at the commit that `scripts/schemas.lock.json` pins. */
const validatorFile = (name: string) => readFileSync(join(SCHEMAS, name), "utf8");

/** The schema of the readers for each class validator of `tasks/validation.py`; the recipient profiles are not read. */
const CLASSES: Readonly<Record<string, readonly (keyof typeof V2_SCHEMAS)[]>> = {
  Assertion: ["assertionV2Schema"],
  BadgeClass: ["badgeClassV2Schema"],
  CryptographicKey: ["cryptographicKeyV2Schema"],
  Profile: ["profileV2Schema"],
  AlignmentObject: ["alignmentObjectV2Schema"],
  Criteria: ["criteriaV2Schema"],
  IdentityObject: ["identityObjectV2Schema"],
  Evidence: ["evidenceV2Schema"],
  Image: ["imageV2Schema", "assertionImageV2Schema"],
  VerificationObjectAssertion: ["assertionVerificationV2Schema"],
  VerificationObjectIssuer: ["profileVerificationV2Schema"],
  RevocationList: ["revocationListV2Schema"],
  Endorsement: ["endorsementV2Schema"],
  EndorsementClaim: ["endorsementClaimV2Schema"],
};

/**
 * The properties that the readers require and the validator does not, each as the guide of Open Badges 2.0 lists it: the
 * specification marks them required, and the validator checks them in a task of its own or not at all.
 */
const REQUIRED_HERE_ONLY: Readonly<Record<string, readonly string[]>> = {
  RevocationList: ["revokedAssertions"],
  Endorsement: ["verification"],
};

/** The properties that each class validator of `tasks/validation.py` requires, its tasks included. */
function requiredByValidator(): ReadonlyMap<string, readonly string[]> {
  const parts = validatorFile("openbadges-validator-core-validation.py").split(
    /\n\s+(?:el)?if class_name == OBClasses\.(\w+)(?: or class_name == OBClasses\.\w+)?:/u,
  );
  const classes = new Map<string, readonly string[]>();
  for (let index = 1; index < parts.length; index += 2) {
    const body = (parts[index + 1] ?? "").split("\n        el")[0] ?? "";
    const required = [...body.matchAll(/\{[^{}]*'prop_name':\s*'([^']+)'[^{}]*'required':\s*True[^{}]*\}/gu)].map(
      (match) => match[1] ?? "",
    );
    classes.set(parts[index] ?? "", [...new Set(required)].sort());
  }
  return classes;
}

describe("the readers of Open Badges 2.0 beside the validator of 1EdTech", () => {
  it("know the terms of the context that the validator compacts every document into", () => {
    const source = validatorFile("openbadges-validator-core-context.py");
    const dictionary = source.slice(source.indexOf("{"), source.indexOf("\nOPENBADGES_CONTEXT_V1_URI"));
    expect(Object.keys(JSON.parse(dictionary)["@context"])).toStrictEqual([...TERMS_V2]);
  });

  it("require what each class validator requires, and the properties the specification adds, of every class", () => {
    const validator = requiredByValidator();
    expect([...validator.keys()].filter((name) => !(name in CLASSES))).toStrictEqual(["ExpectedRecipientProfile"]);
    for (const [name, exports] of Object.entries(CLASSES)) {
      const expected = [...(validator.get(name) ?? []), ...(REQUIRED_HERE_ONLY[name] ?? [])].sort();
      for (const schema of exports) {
        expect([name, [...(heldClass(V2_SCHEMAS[schema])?.required ?? [])].sort()]).toStrictEqual([name, expected]);
      }
    }
  });
});
