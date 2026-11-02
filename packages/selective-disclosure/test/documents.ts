import { hasMoreTokensThan } from "@interopkit/core/checks";
import { OPEN_CONTEXT } from "./contexts.js";

/**
 * A credential whose subject, address and each item of its list are blank nodes, so that the labels that the HMAC gives them
 * matter. The pointers below name its parts.
 */
export function sampleCredential(): Record<string, unknown> {
  return {
    "@context": [OPEN_CONTEXT],
    type: ["VerifiableCredential", "ExampleCredential"],
    issuer: { id: "did:example:issuer", name: "Example Academy" },
    validFrom: "2026-01-01T00:00:00Z",
    credentialSubject: {
      type: "Person",
      name: "Sam Taylor",
      birthDate: "2001-05-17",
      address: { type: "PostalAddress", city: "Bandung", country: "ID" },
      achievements: [
        { type: "Achievement", name: "Algebra", score: 91 },
        { type: "Achievement", name: "Geometry", score: 84 },
      ],
    },
  };
}

/** The mandatory pointers of the tests: the issuer. */
export const MANDATORY_POINTERS: readonly string[] = ["/issuer"];

/** The pointers that a holder reveals in the tests. */
export const SELECTIVE_POINTERS: readonly string[] = ["/credentialSubject/name", "/credentialSubject/achievements/0"];

/** The time of the proofs of the tests. */
export const CREATED = "2026-11-01T09:30:00Z";

/** The tokens of JSON of a text, as the option maxTokens counts them. */
export function tokensOf(text: string): number {
  let tokens = 0;
  while (hasMoreTokensThan(text, tokens)) tokens += 1;
  return tokens;
}
