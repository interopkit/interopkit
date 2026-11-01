import { isRecord } from "@interopkit/core/checks";
import { CRYPTOSUITE } from "../suite.js";
import { BASE_HEADER, prefixOf } from "./header.js";

const BASE_PREFIX = prefixOf(BASE_HEADER);

/**
 * Tells whether a proof is a base proof of the suite: a proof of `ecdsa-sd-2023` whose value starts with the header of a base
 * proof value.
 *
 * @remarks
 * A base proof holds the key of the HMAC and the signature of every statement that a holder can hide, so it goes to the holder
 * and never to a verifier. The test reads the first characters of the value and does not decode it, so it never throws.
 *
 * @param proof - The `proof` of a document, or anything else.
 * @returns Whether it is one. A derived proof, a proof of another suite and a value that is no proof are not.
 */
export function isBaseProof(proof: unknown): boolean {
  return (
    isRecord(proof) &&
    proof.cryptosuite === CRYPTOSUITE &&
    typeof proof.proofValue === "string" &&
    proof.proofValue.startsWith(BASE_PREFIX)
  );
}
