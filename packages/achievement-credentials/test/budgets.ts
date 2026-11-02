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
 * run: five times the highest ratio of three runs, rounded up to one significant digit, as docs/achievement-credentials/evidence.md
 * explains. A reference is a library that does the same work where one is installable, and otherwise the least work of the
 * same kind (`JSON.parse`, `JSON.stringify`, saxes). Both samples come from one run, so a ratio holds on any machine. The
 * budgets in time wait for samples of the runner of CI.
 */
export const RATIOS = {
  /**
   * `verifyCredential` of a JWS, against `did-jwt-vc`, which checks the signature and the format of the claims, and nothing of
   * the issuer or the status. Measured 0.13 to 0.14.
   */
  jwt: 0.8,
  /** `verifyCredential` of a CLR in a JWS that holds 10 credentials in JWS, against `did-jwt-vc` of the 11 JWTs. Measured 0.13 to 0.17. */
  clr: 0.9,
  /** `verifyCredential` with an `eddsa-rdfc-2022` proof, against Digital Bazaar's `vc`, which checks the structure and the proof. Measured 1.03 to 1.08. */
  dataIntegrity: 6,
  /** The same, against `@interop/verifier-core`, which also checks the status and the expiry. Measured 1.05 to 1.07. */
  dataIntegrityInterop: 6,
  /** `addProof` with `eddsa-rdfc-2022`, against `vc.issue` of Digital Bazaar with its suite. Measured 1.01 to 1.04. */
  addProof: 6,
  /** `verifyProof` of `eddsa-rdfc-2022`, against `vc.verifyCredential` of Digital Bazaar. Measured 1.05 to 1.11. */
  verifyProofEddsa: 6,
  /** `verifyProof` of `ecdsa-rdfc-2019`, against `@interop/verifier-core`. Measured 0.86 to 0.88. */
  verifyProofEcdsa: 5,
  /** `verifyProof` of `Ed25519Signature2020` with `legacyProofs`, against `@interop/verifier-core`. Measured 1.03 to 1.06. */
  verifyProofLegacy: 6,
  /** `verifyProof` of an `ecdsa-sd-2023` disclosure, against Digital Bazaar's `vc` with its `ecdsa-sd-2023` suite. Measured 0.91 to 0.92. */
  verifyProofSelective: 5,
  /** `readCredentialJwt`, against `verifyCredential` of `did-jwt-vc`. Measured 0.12 to 0.13. */
  readCredentialJwt: 0.7,
  /** `signCredentialJwt` with EdDSA, against `createVerifiableCredentialJwt` of `did-jwt-vc`. Measured 0.11. */
  signCredentialJwt: 0.6,
  /** `issueStatusListCredential` of 131,072 entries with a Data Integrity proof, against `@interop/vc-bitstring-status-list` and `jsigs.sign`. Measured 0.88 to 0.90. */
  issueStatusList: 5,
  /** `verifyCredentialStatus` against such a list, fetched and verified each time, against `checkStatus` of `@interop/vc-bitstring-status-list`. Measured 1.29 to 1.37. */
  verifyCredentialStatus: 7,
  /** `readCredential` of a CLR of 20 credentials, against the official schema of CLR 2.0 in `@cfworker/json-schema`. Measured 0.16 to 0.17. */
  readCredential: 0.9,
  /** `validateCredential` of the same CLR, against the same schema. Measured 0.17. */
  validateCredential: 0.9,
  /** `bakePng` of the CLR into an image of 256 KiB, against `JSON.stringify` of the CLR. Measured 29.9 to 30.3. */
  bakePng: 200,
  /** `readPng` of that image, against `JSON.parse` of the CLR. Measured 4.06 to 4.08. */
  readPng: 30,
  /** `bakeSvg` of the CLR into an SVG of 140,000 characters, against saxes over the SVG. Measured 1.56 to 1.81. */
  bakeSvg: 10,
  /** `readSvg` of that SVG, which stops at the credential, against saxes over all of it. Measured 0.61 to 0.66. */
  readSvg: 4,
  /** `handleCredentialsRequest` of a page of 100 credentials, against `JSON.stringify` of the page. Measured 1.35 to 1.44. */
  listCredentials: 8,
  /** `handleCredentialsRequest` of the upsert of a CLR of 20 credentials, against `JSON.parse` of its body. Measured 5.7 to 5.8. */
  upsertCredential: 30,
  /** `handleRefreshRequest` of a CLR of 20 credentials, against `JSON.stringify` of it. Measured 1.01 to 1.08. */
  refresh: 6,
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
