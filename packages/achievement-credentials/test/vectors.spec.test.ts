/**
 * The published test vectors of the cryptosuites and of `did:key`, run through the glue of the package.
 *
 * The vectors come from the pages below, which `pnpm spec-examples` downloads at pinned hashes of the JSON that they print
 * (`scripts/spec-examples.lock.json`), and the contexts that they need come from `pnpm schemas` (`scripts/schemas.lock.json`).
 * All three pages were read on 2026-11-02.
 *
 * - Data Integrity EdDSA Cryptosuites v1.0, W3C Recommendation of 2025-05-15, appendix B: https://www.w3.org/TR/2025/REC-vc-di-eddsa-20250515/
 * - Data Integrity ECDSA Cryptosuites v1.0, W3C Recommendation of 2025-05-15, appendix A: https://www.w3.org/TR/2025/REC-vc-di-ecdsa-20250515/
 * - The did:key Method v0.9, W3C Credentials Community Group draft: https://w3c-ccg.github.io/did-key-spec/
 *
 * What a vector can show depends on the cryptosuite. `eddsa-rdfc-2022` is deterministic, so its proof is signed again from the
 * unsigned document and the secret key of the page, and equals the printed proof byte for byte. ECDSA through Web Crypto draws
 * a random nonce, so `ecdsa-rdfc-2019` is checked by verifying the printed proof, and so is `ecdsa-sd-2023`, whose base proof
 * also draws its keys at random (they have no source that a host can replace): its derived proof is deterministic from a base
 * proof, so the printed derived proof is derived again from the printed base proof, byte for byte.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCryptoKeySigner } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { loadList, schemaDirectory } from "../../../scripts/schemas.js";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import { addProof, createContextLoader, deriveDisclosure, verifyProof } from "../src/data-integrity/index.js";
import { contextHash } from "../src/data-integrity/internal.js";
import type { IssuableCredential } from "../src/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { clockAt, fromMultibase } from "./key-fixtures.js";

const ROOT = resolve(import.meta.dirname, "../../..");

type Document = Record<string, unknown>;

/** The contexts that the vectors name, by address, from the files that `pnpm schemas` downloaded. */
const FILES = new Map(loadList(ROOT).map(({ url, file }) => [url, file]));
const VECTOR_CONTEXTS = [
  "https://www.w3.org/ns/credentials/v2",
  "https://www.w3.org/ns/credentials/examples/v2",
  "https://w3id.org/citizenship/v4rc1",
  "https://w3id.org/security/suites/ed25519-2020/v1",
];
const DOCUMENTS = new Map(
  VECTOR_CONTEXTS.map((url) => {
    const file = FILES.get(url);
    if (file === undefined) throw new Error(`${url} is not in the list of downloads.`);
    return [url, JSON.parse(readFileSync(resolve(schemaDirectory(ROOT), file), "utf8"))] as const;
  }),
);
// The pins of the contexts that the package does not know are those of the downloaded files, which `pnpm schemas` checked.
const PINS = new Map(VECTOR_CONTEXTS.map((url) => [url, contextHash(DOCUMENTS.get(url))] as const));
const contexts = createContextLoader({ documents: DOCUMENTS, pins: PINS });
const keys = createKeyResolver({ clock: clockAt(0) });

/** A secured document of a page, with the document before it was secured and the proof as it was printed. */
interface Signed {
  readonly unsigned: Document;
  readonly secured: Document;
  readonly proof: Document;
}

/** The secured documents of a page whose proof is selected, in the order of the page, with their position. */
function securedBlocks(
  blocks: readonly unknown[],
  select: (proof: Document, block: Document) => boolean,
): { readonly index: number; readonly secured: Document; readonly proof: Document }[] {
  return blocks.flatMap((block, index) => {
    const proof = (block as Document).proof as Document | undefined;
    return proof !== undefined && typeof proof.proofValue === "string" && select(proof, block as Document)
      ? [{ index, secured: block as Document, proof }]
      : [];
  });
}

/**
 * Reads the vectors of a page that print, in this order, a document without proof, the options of the proof and the secured
 * document: the unsecured document is the secured one less its proof, and the options are the proof less its value, which
 * shows that the blocks belong together.
 */
function printedVectors(blocks: readonly unknown[], select: (proof: Document) => boolean): Signed[] {
  return securedBlocks(blocks, (proof) => select(proof)).map(({ index, secured, proof }) => {
    const { proof: _proof, ...rest } = secured;
    const unsigned = blocks[index - 2] as Document;
    const { proofValue: _value, ...options } = proof;
    expect(unsigned, `the unsecured document before block ${index}`).toStrictEqual(rest);
    // The options are the proof less its value, with the context of the document that the canonical form of the proof takes.
    expect(blocks[index - 1], `the options of the proof before block ${index}`).toStrictEqual({
      "@context": secured["@context"],
      ...options,
    });
    return { unsigned, secured, proof };
  });
}

const clockAtProof = (proof: Document) => clockAt(Date.parse(String(proof.created)));
const readOptions = { keys, clock: clockAt(Date.parse("2024-01-01T00:00:00Z")), contexts, allowUnboundKeys: true };

describe("the vectors of eddsa-rdfc-2022", () => {
  const blocks = readSpecPage(ROOT, "vc-di-eddsa-1p0.json");
  const vectors = printedVectors(blocks, (proof) => proof.cryptosuite === "eddsa-rdfc-2022" && proof.id === undefined);
  const alumni = vectors.filter(({ unsigned }) => (unsigned.type as string[]).includes("AlumniCredential"));
  const employment = vectors.filter(({ unsigned }) =>
    (unsigned.type as string[]).includes("EmploymentAuthorizationDocumentCredential"),
  );
  // Example 7 of the page: the key pair that signs the vectors of appendix B.1.
  const PUBLIC = "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2";
  const SECRET = "z3u2en7t5LR2WtQH5PfFqMqwVHBeXouLzo6haApm8XHqvjxq";
  /** The header of an Ed25519 private key in Multikey (`ed25519-priv`, 0x1300) and of a public key (`ed25519-pub`, 0xed01). */
  const PRIVATE_HEADER = [0x80, 0x26];
  const PUBLIC_HEADER = [0xed, 0x01];
  /** The PKCS#8 prefix of an Ed25519 private key (RFC 8410 section 7): the seed of 32 bytes follows. */
  const PKCS8_PREFIX = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);

  async function signerOfPage(keyId: string) {
    const secret = fromMultibase(SECRET);
    expect([...secret.subarray(0, 2)]).toStrictEqual(PRIVATE_HEADER);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      Uint8Array.from([...PKCS8_PREFIX, ...secret.subarray(2)]),
      "Ed25519",
      true,
      ["sign"],
    );
    return { key, signer: createCryptoKeySigner(key, { algorithm: "EdDSA", keyId }) };
  }

  it("holds the vectors that the tests sign: the alumni credential and the credential of an employment authorization", () => {
    expect(alumni).toHaveLength(1);
    expect(employment).toHaveLength(1);
    expect(vectors.map(({ proof }) => proof.verificationMethod)).toStrictEqual([
      `did:key:${PUBLIC}#${PUBLIC}`,
      `did:key:${PUBLIC}#${PUBLIC}`,
    ]);
  });

  it("has a secret key whose public key is the one of the page", async () => {
    const { key } = await signerOfPage(`did:key:${PUBLIC}#${PUBLIC}`);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    const raw = fromMultibase(PUBLIC);
    expect([...raw.subarray(0, 2)]).toStrictEqual(PUBLIC_HEADER);
    expect(Buffer.from(raw.subarray(2)).toString("base64url")).toBe(jwk.x);
  });

  it("signs the alumni credential again, and the proof equals the printed one byte for byte", async () => {
    const [{ unsigned, secured, proof }] = alumni as [Signed];
    const { signer } = await signerOfPage(String(proof.verificationMethod));
    const signed = await addProof(unsigned as unknown as IssuableCredential, signer, {
      contexts,
      clock: clockAtProof(proof),
    });
    const [written] = (signed as unknown as { proof: Document[] }).proof;
    expect(written?.proofValue).toBe(proof.proofValue);
    expect(written).toStrictEqual(proof);
    // The glue writes the proof as a list, as the model does; the rest of the document is the page's.
    expect(signed).toStrictEqual({ ...secured, proof: [proof] });
  });

  it("verifies the printed alumni credential: the signature is good, and the key is not the issuer's", async () => {
    const [{ secured }] = alumni as [Signed];
    const credential = secured as unknown as IssuableCredential;
    expect(await verifyProof(credential, readOptions)).toMatchObject({
      valid: true,
      bound: false,
      key: { controller: `did:key:${PUBLIC}` },
    });
    // The issuer of the vector is an address that publishes no key, so by default the proof is not accepted.
    expect(await verifyProof(credential, { ...readOptions, allowUnboundKeys: false })).toMatchObject({
      valid: false,
      reason: expect.stringContaining("controlled by"),
    });
  });

  it("refuses the credential of an employment authorization, whose issuer has no type: it is no credential of the model", async () => {
    // Finding: the issuer of this vector is an object with an `id` and an `image` and no `type`, and the Profile of Open Badges
    // requires a type. The glue works on the credentials of Open Badges and CLR, so it refuses the vector and does not bypass the check.
    const [{ unsigned, secured, proof }] = employment as [Signed];
    const { signer } = await signerOfPage(String(proof.verificationMethod));
    await expect(
      addProof(unsigned as unknown as IssuableCredential, signer, { contexts, clock: clockAtProof(proof) }),
    ).rejects.toThrow("The credential is invalid at issuer.type");
    expect(await verifyProof(secured as unknown as IssuableCredential, readOptions)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("issuer.type"),
    });
  });

  it("verifies the vector of Ed25519Signature2020 only when legacy proofs are allowed", async () => {
    const [legacy] = securedBlocks(
      blocks,
      (proof, block) => proof.type === "Ed25519Signature2020" && block.credentialSubject !== undefined,
    );
    const credential = legacy?.secured as unknown as IssuableCredential;
    expect(await verifyProof(credential, readOptions)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("legacyProofs"),
    });
    expect(await verifyProof(credential, { ...readOptions, legacyProofs: true })).toMatchObject({
      valid: true,
      bound: false,
    });
  });

  it("does not take the vectors of eddsa-jcs-2022 and ecdsa-jcs-2019: no suite of the package verifies them", async () => {
    const pages = [
      ["vc-di-eddsa-1p0.json", "eddsa-jcs-2022"],
      ["vc-di-ecdsa-1p0.json", "ecdsa-jcs-2019"],
    ] as const;
    for (const [file, cryptosuite] of pages) {
      const [jcs] = securedBlocks(readSpecPage(ROOT, file), (proof) => proof.cryptosuite === cryptosuite);
      expect(await verifyProof(jcs?.secured as unknown as IssuableCredential, readOptions)).toMatchObject({
        valid: false,
        reason: `No suite verifies the cryptosuite ${cryptosuite}.`,
      });
    }
  });
});

describe("the vectors of ecdsa-rdfc-2019", () => {
  const blocks = readSpecPage(ROOT, "vc-di-ecdsa-1p0.json");
  const vectors = printedVectors(blocks, (proof) => proof.cryptosuite === "ecdsa-rdfc-2019");
  const bySubject = (type: string) => vectors.filter(({ unsigned }) => (unsigned.type as string[]).includes(type));
  // The first of each pair is signed with a P-256 key, and the second with a P-384 key, in the order of the page.
  const alumni = bySubject("AlumniCredential");
  const employment = bySubject("EmploymentAuthorizationDocumentCredential");

  it("holds the vectors: an alumni credential and an employment authorization for each of the two curves", () => {
    expect(alumni).toHaveLength(2);
    expect(employment).toHaveLength(2);
    expect([...alumni, ...employment].map(({ proof }) => String(proof.verificationMethod).slice(0, 13))).toStrictEqual([
      "did:key:zDnae",
      "did:key:z82Lk",
      "did:key:zDnae",
      "did:key:z82Lk",
    ]);
  });

  it.each([
    ["P-256", 0],
    ["P-384", 1],
  ] as const)("verifies the printed alumni credential of %s through the key of its did:key", async (_curve, index) => {
    const credential = alumni[index]?.secured as unknown as IssuableCredential;
    const result = await verifyProof(credential, readOptions);
    expect(result).toMatchObject({ valid: true, bound: false });
    expect(result.valid && result.key.controller).toBe(String(alumni[index]?.proof.verificationMethod).split("#")[0]);
    const changed = { ...credential, name: "Alumni Credential." } as unknown as IssuableCredential;
    expect((await verifyProof(changed, readOptions)).valid).toBe(false);
  });

  it.each([
    ["P-256", 0],
    ["P-384", 1],
  ] as const)(
    "refuses the printed employment authorization of %s, whose issuer has no type: it is no credential of the model",
    async (_curve, index) => {
      // Finding: as for EdDSA, the issuer is an object with an `id` and an `image` and no `type`, which a Profile requires.
      const credential = employment[index]?.secured as unknown as IssuableCredential;
      expect(await verifyProof(credential, readOptions)).toMatchObject({
        valid: false,
        reason: expect.stringContaining("issuer.type"),
      });
    },
  );
});

describe("the vectors of ecdsa-sd-2023", () => {
  const blocks = readSpecPage(ROOT, "vc-di-ecdsa-1p0.json");
  const starts = blocks.flatMap((block, index) =>
    typeof block === "object" && block !== null && "baseKeyPair" in block ? [index] : [],
  );
  // Each example prints its key pairs, the credential, the pointers, the base proof and the disclosure: the first credential
  // with a proof after the key pairs holds the base proof, and the next one holds the derived proof.
  const examples = starts.map((start, at) => {
    const own = blocks.slice(start, starts[at + 1] ?? blocks.length) as Document[];
    const [base, derived] = own.filter((block) => block.proof !== undefined && "@context" in block);
    const pointers = own.find(
      (block) => Array.isArray(block) && block.length === 3 && block[0] === "/validFrom",
    ) as unknown as string[];
    return { base: base as Document, derived: derived as Document, pointers };
  });

  it("holds the two examples of the page, each with a base proof, the pointers and a disclosure", () => {
    expect(examples).toHaveLength(2);
    for (const { base, derived, pointers } of examples) {
      expect((base.proof as Document).cryptosuite).toBe("ecdsa-sd-2023");
      expect((derived.proof as Document).cryptosuite).toBe("ecdsa-sd-2023");
      expect(String((base.proof as Document).proofValue)).not.toBe(String((derived.proof as Document).proofValue));
      expect(pointers).toStrictEqual(["/validFrom", "/validUntil", "/credentialSubject/birthCountry"]);
    }
  });

  it("refuses the credentials of both examples, whose issuer has no type: they are no credentials of the model", async () => {
    // Finding: the credential of both examples is an employment authorization or a permanent resident card whose issuer is an
    // object with an `id` and an `image` and no `type`, which the Profile of Open Badges requires. The glue works on the
    // credentials of Open Badges and CLR, so it refuses all three calls, and does not bypass the check. The vectors of these
    // proofs are reproduced byte for byte by the tests of `@interopkit/selective-disclosure`, which knows no model.
    for (const { base, derived, pointers } of examples) {
      const refusal = expect.stringContaining("issuer.type");
      expect(await verifyProof(base as unknown as IssuableCredential, readOptions)).toMatchObject({
        valid: false,
        reason: refusal,
      });
      expect(await verifyProof(derived as unknown as IssuableCredential, readOptions)).toMatchObject({
        valid: false,
        reason: refusal,
      });
      await expect(
        deriveDisclosure(base as unknown as IssuableCredential, { selectivePointers: pointers, contexts }),
      ).rejects.toThrow("The disclosure is invalid at issuer.type");
    }
  });
});

describe("the vectors of did:key", () => {
  const [specification] = readSpecPage(ROOT, "did-key-0p9.json") as [Document];
  const [method] = specification.verificationMethod as [Document];
  const RELATIONSHIPS = ["assertionMethod", "authentication", "capabilityInvocation", "capabilityDelegation"];

  it("resolves the Ed25519 key of the DID document that the specification prints, with its relationships", async () => {
    const published = await keys.issuerKeys(String(specification.id));
    expect(published).toHaveLength(1);
    const listed = RELATIONSHIPS.filter((name) => (specification[name] as string[]).includes(String(method.id)));
    expect(listed).toHaveLength(4);
    expect(published[0]).toMatchObject({ id: method.id, controller: method.controller });
    expect([...(published[0]?.relationships ?? [])].sort()).toStrictEqual([...listed].sort());
    // The key is the 32 bytes that follow the two bytes of the multicodec header, written as a JWK (RFC 8037).
    const raw = fromMultibase(String(method.publicKeyMultibase));
    expect(published[0]?.publicKeyJwk).toStrictEqual({
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(raw.subarray(2)).toString("base64url"),
    });
    expect(await keys.resolve(String(method.id))).toStrictEqual(published[0]);
  });

  it("does not resolve the key agreement key of the document, which is no key for a signature", async () => {
    const [agreement] = specification.keyAgreement as [Document];
    expect(await keys.resolve(String(agreement.id))).toBeUndefined();
  });

  /** The parameters of the curves of NIST FIPS 186-4 (D.1.2.3 and D.1.2.4): `p` is 3 modulo 4, so a square root is a power. */
  const CURVES = {
    "P-256": {
      bytes: 32,
      p: 2n ** 256n - 2n ** 224n + 2n ** 192n + 2n ** 96n - 1n,
      b: 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn,
    },
    "P-384": {
      bytes: 48,
      p: 2n ** 384n - 2n ** 128n - 2n ** 96n + 2n ** 32n - 1n,
      b: 0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aefn,
    },
  } as const;

  const modularPower = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
    let result = 1n;
    let square = base % modulus;
    for (let remaining = exponent; remaining > 0n; remaining >>= 1n) {
      if (remaining & 1n) result = (result * square) % modulus;
      square = (square * square) % modulus;
    }
    return result;
  };
  const toBase64Url = (value: bigint, bytes: number) =>
    Buffer.from(value.toString(16).padStart(bytes * 2, "0"), "hex").toString("base64url");

  /** Decompresses the point of a Multikey of a NIST curve: the two bytes of the header, a parity byte and `x`. */
  function decompress(curve: keyof typeof CURVES, multikey: string): { x: string; y: string } {
    const { bytes, p, b } = CURVES[curve];
    const raw = fromMultibase(multikey);
    expect(raw).toHaveLength(2 + 1 + bytes);
    const x = BigInt(`0x${Buffer.from(raw.subarray(3)).toString("hex")}`);
    const rhs = (modularPower(x, 3n, p) - 3n * x + b) % p;
    const root = modularPower((rhs + p) % p, (p + 1n) / 4n, p);
    const odd = raw[2] === 0x03;
    return { x: toBase64Url(x, bytes), y: toBase64Url(root % 2n === (odd ? 1n : 0n) ? root : p - root, bytes) };
  }

  const ecdsa = printedVectors(
    readSpecPage(ROOT, "vc-di-ecdsa-1p0.json"),
    (proof) => proof.cryptosuite === "ecdsa-rdfc-2019",
  );

  it.each([
    ["P-256", "zDnae"],
    ["P-384", "z82Lk"],
  ] as const)(
    "resolves the %s key of a vector to the point that an independent decompression gives",
    async (curve, prefix) => {
      const [{ proof }] = ecdsa.filter(({ proof: printed }) =>
        String(printed.verificationMethod).startsWith(`did:key:${prefix}`),
      ) as [Signed];
      const method = String(proof.verificationMethod);
      const resolved = await keys.resolve(method);
      const multikey = method.split("#")[1] as string;
      const expected = decompress(curve, multikey);
      expect(resolved?.publicKeyJwk).toStrictEqual({ kty: "EC", crv: curve, ...expected });
      // The point is on the curve, which Web Crypto checks when it imports the key: so the constants of the curve above are right.
      await expect(
        crypto.subtle.importKey(
          "jwk",
          { kty: "EC", crv: curve, ...expected },
          { name: "ECDSA", namedCurve: curve },
          true,
          ["verify"],
        ),
      ).resolves.toBeDefined();
    },
  );
});
