import { expect, type TestContext } from "vitest";
import {
  alternate as alternateRounds,
  type RoundOptions,
  reportRatio,
  type Sides,
} from "../../../scripts/bench-rounds.js";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
const BENCH_OPTIONS = { time: 1000, iterations: 20, warmupTime: 200, warmupIterations: 5 } as const;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of its reference in the same
 * run: twice the highest ratio measured on the runner of CI in 12 runs of the bench job on 2026-11-04 and 2026-11-05, rounded up to one significant digit, as
 * docs/achievement-credentials/performance.md explains. A
 * reference is a library that does the same work where one is installable, and otherwise the least work of the same kind
 * (`JSON.parse`, `JSON.stringify`, saxes). Both samples come from one run, so a ratio holds on any machine.
 */
export const RATIOS = {
  /**
   * `verifyCredential` of a JWS, against `did-jwt-vc`, which checks the signature and the format of the claims, and nothing of
   * the issuer or the status. Measured 0.18 to 0.28.
   */
  jwt: 0.6,
  /** `verifyCredential` of a CLR in a JWS that holds 10 credentials in JWS, against `did-jwt-vc` of the 11 JWTs. Measured 0.19 to 0.29. */
  clr: 0.6,
  /** `verifyCredential` with an `eddsa-rdfc-2022` proof, against Digital Bazaar's `vc`, which checks the structure and the proof. Measured 1.06 to 1.14. */
  dataIntegrity: 3,
  /** The same, against `@interop/verifier-core`, which also checks the status and the expiry. Measured 1.03 to 1.07. */
  dataIntegrityInterop: 3,
  /** `addProof` with `eddsa-rdfc-2022`, against `vc.issue` of Digital Bazaar with its suite. Measured 1.03 to 1.09. */
  addProof: 3,
  /** `verifyProof` of `eddsa-rdfc-2022`, against `vc.verifyCredential` of Digital Bazaar. Measured 1.04 to 1.15. */
  verifyProofEddsa: 3,
  /** `verifyProof` of `ecdsa-rdfc-2019`, against `@interop/verifier-core`. Measured 0.84 to 0.91. */
  verifyProofEcdsa: 2,
  /** `verifyProof` of `Ed25519Signature2020` with `legacyProofs`, against `@interop/verifier-core`. Measured 1.01 to 1.09. */
  verifyProofLegacy: 3,
  /** `verifyProof` of an `ecdsa-sd-2023` disclosure, against Digital Bazaar's `vc` with its `ecdsa-sd-2023` suite. Measured 0.92 to 1.01. */
  verifyProofSelective: 3,
  /** `readCredentialJwt`, against `verifyCredential` of `did-jwt-vc`. Measured 0.16 to 0.25. */
  readCredentialJwt: 0.6,
  /** `signCredentialJwt` with EdDSA, against `createVerifiableCredentialJwt` of `did-jwt-vc`. Measured 0.12 to 0.19. */
  signCredentialJwt: 0.4,
  /** `issueStatusListCredential` of 131,072 entries with a Data Integrity proof, against `@interop/vc-bitstring-status-list` and `jsigs.sign`. Measured 1.09 to 1.23. */
  issueStatusList: 3,
  /** `verifyCredentialStatus` against such a list, fetched and verified each time, against `checkStatus` of `@interop/vc-bitstring-status-list`. Measured 1.35 to 1.71. */
  verifyCredentialStatus: 4,
  /** `readCredential` of a CLR of 20 credentials, against the official schema of CLR 2.0 in `@cfworker/json-schema`, a validator that does the same work. Measured 0.10 to 0.17. */
  readCredential: 0.4,
  /** `validateCredential` of the same CLR, against the same schema. Measured 0.10 to 0.17. */
  validateCredential: 0.4,
  /** `bakePng` of the CLR into an image of 256 KiB, against `JSON.stringify` of the CLR. Measured 11.3 to 18.2. */
  bakePng: 40,
  /** `readPng` of that image, against `JSON.parse` of the CLR. Measured 2.64 to 3.50. */
  readPng: 8,
  /** `bakeSvg` of the CLR into an SVG of 140,000 characters, against saxes over the SVG. Measured 1.37 to 1.72. */
  bakeSvg: 4,
  /** `readSvg` of that SVG, which stops at the credential, against saxes over all of it. Measured 0.53 to 0.69. */
  readSvg: 2,
  /** `handleCredentialsRequest` of a page of 100 credentials, against `JSON.stringify` of the page. Measured 1.20 to 1.29. */
  listCredentials: 3,
  /** `handleCredentialsRequest` of the upsert of a CLR of 20 credentials, against `JSON.parse` of its body. Measured 4.11 to 6.99. */
  upsertCredential: 20,
  /** `handleRefreshRequest` of a CLR of 20 credentials, against `JSON.stringify` of it. Measured 1.05 to 1.08. */
  refresh: 3,
} as const;

/**
 * Reports the fastest and the median sample of a function and of its reference, and fails the test when the fastest sample of
 * the function is above its ratio to the reference's.
 */
export async function expectRatioWithin(
  annotate: TestContext["annotate"],
  name: keyof typeof RATIOS,
  reference: string,
  sides: Sides,
): Promise<void> {
  const ratio = await reportRatio(annotate, name, reference, sides, RATIOS[name]);
  expect(ratio, `The fastest sample of ${name} as a multiple of ${reference}`).toBeLessThan(RATIOS[name]);
}

/** Times a function and its reference in turns, with the run options of the package unless others are given. */
export function alternate(
  bench: TestContext["bench"],
  name: string,
  ours: () => unknown,
  reference: { readonly name: string; readonly run: () => unknown },
  options: RoundOptions = BENCH_OPTIONS,
): Promise<Sides> {
  return alternateRounds(bench, name, ours, reference, options);
}
