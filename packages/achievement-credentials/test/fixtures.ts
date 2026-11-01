/**
 * The smallest values that the schemas of 1EdTech accept, derived from the required properties of each class. They are the
 * starting points of the tests that change one thing; nothing else is typed by hand.
 */
import type { Achievement, Profile } from "../src/index.js";

export type Value = Record<string, unknown>;

const VC_V2 = "https://www.w3.org/ns/credentials/v2";
const VC_V1 = "https://www.w3.org/2018/credentials/v1";
const OB = "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json";
const CLR = "https://purl.imsglobal.org/spec/clr/v2p0/context-2.0.1.json";

export const PROFILE: Profile = { id: "https://example.edu/issuers/1", type: ["Profile"] };

export const ACHIEVEMENT: Achievement = {
  id: "https://example.edu/achievements/1",
  type: ["Achievement"],
  criteria: { narrative: "Pass the course." },
  description: "Passed the course.",
  name: "Course",
};

const SUBJECT: Value = { id: "did:example:learner", type: ["AchievementSubject"], achievement: ACHIEVEMENT };

export function achievementCredential(): Value {
  return {
    "@context": [VC_V2, OB],
    id: "https://example.edu/credentials/1",
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: PROFILE,
    validFrom: "2024-06-13T10:00:00Z",
    credentialSubject: SUBJECT,
  };
}

export function achievementCredentialV1p1(): Value {
  return {
    "@context": [VC_V1, OB],
    id: "https://example.edu/credentials/1",
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    name: "Course badge",
    issuer: PROFILE,
    issuanceDate: "2024-06-13T10:00:00Z",
    credentialSubject: SUBJECT,
  };
}

export function endorsementCredential(): Value {
  return {
    "@context": [VC_V2, OB],
    id: "https://example.edu/endorsements/1",
    type: ["VerifiableCredential", "EndorsementCredential"],
    name: "Endorsement",
    issuer: PROFILE,
    validFrom: "2024-06-13T10:00:00Z",
    credentialSubject: { id: "https://example.edu/achievements/1", type: ["EndorsementSubject"] },
  };
}

export function clrCredential(): Value {
  return {
    "@context": [VC_V2, CLR, OB],
    id: "https://example.edu/clrs/1",
    type: ["VerifiableCredential", "ClrCredential"],
    name: "Transcript",
    issuer: PROFILE,
    validFrom: "2024-06-13T10:00:00Z",
    credentialSubject: {
      id: "did:example:learner",
      type: ["ClrSubject"],
      verifiableCredential: [achievementCredential()],
    },
  };
}

export function verifiableCredential(): Value {
  return {
    "@context": [VC_V2],
    type: ["VerifiableCredential"],
    issuer: "https://example.edu/issuers/1",
    validFrom: "2024-06-13T10:00:00Z",
    credentialSubject: {},
  };
}
