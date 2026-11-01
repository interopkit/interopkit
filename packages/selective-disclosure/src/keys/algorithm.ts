/** The algorithm of the keys of the suite, in the words of Web Crypto: ECDSA over the curve P-256. */
export const ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const;

/** ES256 in the words of Web Crypto: ECDSA over P-256 with SHA-256, which signs the statements and the proof. */
export const ES256 = { name: ECDSA_P256.name, hash: "SHA-256" } as const;
