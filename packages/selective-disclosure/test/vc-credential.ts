/**
 * A credential of Verifiable Credentials 2.0 with the number of achievements that the caller asks for. Its subject, its address
 * and each achievement are blank nodes, and `@vocab` defines the terms of its own.
 */
export function vcCredential(achievements = 2): Record<string, unknown> {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2", { "@vocab": "https://example.test/vocab#" }],
    type: ["VerifiableCredential", "ExampleCredential"],
    issuer: { id: "https://example.test/issuers/1", name: "Example Academy" },
    validFrom: "2026-01-01T00:00:00Z",
    credentialSubject: {
      type: "Person",
      name: "Sam Taylor",
      birthDate: "2001-05-17",
      address: { type: "PostalAddress", city: "Bandung", country: "ID" },
      achievements: Array.from({ length: achievements }, (_, index) => ({
        type: "Achievement",
        name: `Course ${index}`,
        score: 60 + index,
        notes: { text: `Note ${index}` },
      })),
    },
  };
}
