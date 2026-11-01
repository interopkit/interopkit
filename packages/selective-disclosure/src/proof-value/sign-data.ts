/**
 * Joins what the issuer's key signs: the hash of the proof options, the public key of the proof and the hash of the mandatory
 * statements, in that order (Data Integrity ECDSA Cryptosuites, section 3.5.1).
 */
export function signData(proofHash: Uint8Array, publicKey: Uint8Array, mandatoryHash: Uint8Array): Uint8Array {
  const data = new Uint8Array(proofHash.length + publicKey.length + mandatoryHash.length);
  data.set(proofHash);
  data.set(publicKey, proofHash.length);
  data.set(mandatoryHash, proofHash.length + publicKey.length);
  return data;
}
