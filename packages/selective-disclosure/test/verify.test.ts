import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import { addBaseProof, deriveProof, selectiveDisclosureSuite } from "../src/index.js";
import { createProofKey } from "../src/keys/index.js";
import { parseDerivedProofValue } from "../src/proof-value/index.js";
import { hangingContexts, memoryContexts } from "./contexts.js";
import { CREATED, MANDATORY_POINTERS, SELECTIVE_POINTERS, sampleCredential, tokensOf } from "./documents.js";
import { forgedLabels, proofWith, statementsOf } from "./forge.js";
import { createIssuer } from "./keys.js";
import { type Disclosure, disclosure, signedCredential } from "./setup.js";

const { verify } = selectiveDisclosureSuite;

/** Whether the proof of a disclosure, or a change of it, verifies under the issuer's key. */
async function check(
  { issuer, contexts, document, proof }: Disclosure,
  change: {
    document?: Record<string, unknown>;
    proof?: Record<string, unknown>;
    maxBytes?: number;
    maxTokens?: number;
  } = {},
): Promise<boolean> {
  return verify(change.document ?? document, change.proof ?? proof, {
    publicKeyJwk: issuer.publicKeyJwk,
    contexts: contexts.load,
    ...(change.maxBytes === undefined ? {} : { maxBytes: change.maxBytes }),
    ...(change.maxTokens === undefined ? {} : { maxTokens: change.maxTokens }),
  });
}

/** The revealed document with the revealed name changed. */
function renamed(document: Record<string, unknown>, name: string): Record<string, unknown> {
  return { ...document, credentialSubject: { ...(document.credentialSubject as object), name } };
}

describe("selectiveDisclosureSuite", () => {
  it("names the cryptosuite of the proofs it verifies", () => {
    expect(selectiveDisclosureSuite.cryptosuite).toBe("ecdsa-sd-2023");
  });

  it("accepts a derived proof under the key of the issuer", async () => {
    expect(await check(await disclosure())).toBe(true);
  });

  it("accepts a disclosure of the mandatory parts alone, and of the whole credential", async () => {
    expect(await check(await disclosure([]))).toBe(true);
    expect(await check(await disclosure([""]))).toBe(true);
  });

  it("changes nothing it is given: a frozen document, proof and key are checked", async () => {
    const shown = await disclosure();
    expect(
      await verify(deepFreeze(structuredClone(shown.document)), deepFreeze(structuredClone(shown.proof)), {
        publicKeyJwk: deepFreeze({ ...shown.issuer.publicKeyJwk }),
        contexts: shown.contexts.load,
      }),
    ).toBe(true);
  });

  it("leaves the document and the proof as they were", async () => {
    const shown = await disclosure();
    const before = structuredClone({ document: shown.document, proof: shown.proof });
    await check(shown);
    expect({ document: shown.document, proof: shown.proof }).toStrictEqual(before);
  });

  it("ignores a proof property of the document, which is not what the proof covers", async () => {
    const shown = await disclosure();
    expect(await check(shown, { document: { ...shown.document, proof: { type: "Other" } } })).toBe(true);
  });

  it("reads contexts only through the loader the caller passes", async () => {
    const shown = await disclosure();
    const fresh = memoryContexts();
    expect(
      await verify(shown.document, shown.proof, { publicKeyJwk: shown.issuer.publicKeyJwk, contexts: fresh.load }),
    ).toBe(true);
    expect(fresh.requested.length).toBeGreaterThan(0);
  });
});

describe("selectiveDisclosureSuite, given a disclosure that was changed", () => {
  it("rejects a revealed value that was changed, and a mandatory one", async () => {
    const shown = await disclosure();
    expect(await check(shown, { document: renamed(shown.document, "Someone Else") })).toBe(false);
    expect(await check(shown, { document: { ...shown.document, issuer: { id: "did:example:other" } } })).toBe(false);
  });

  it("rejects a statement that was added, and one that was removed", async () => {
    const shown = await disclosure();
    const subject = shown.document.credentialSubject as Record<string, unknown>;
    expect(
      await check(shown, { document: { ...shown.document, credentialSubject: { ...subject, nickname: "S" } } }),
    ).toBe(false);
    const { name: _name, ...nameless } = subject;
    expect(await check(shown, { document: { ...shown.document, credentialSubject: nameless } })).toBe(false);
  });

  it("rejects a change of the proof options: the time, the verification method and the purpose", async () => {
    const shown = await disclosure();
    for (const change of [
      { created: "2020-01-01T00:00:00Z" },
      { verificationMethod: "https://example.test/issuers/2#key-1" },
      { proofPurpose: "authentication" },
      { domain: "example.test" },
    ]) {
      expect(await check(shown, { proof: { ...shown.proof, ...change } })).toBe(false);
    }
  });

  it("accepts a proof without created, and rejects it when a created is added", async () => {
    const issuer = await createIssuer();
    const contexts = memoryContexts();
    const base = await addBaseProof(sampleCredential(), {
      signer: issuer.signer,
      mandatoryPointers: MANDATORY_POINTERS,
      contexts: contexts.load,
    });
    const { proof, ...document } = await deriveProof(base, {
      selectivePointers: SELECTIVE_POINTERS,
      contexts: contexts.load,
    });
    const shown = proof as Record<string, unknown>;
    expect(shown).not.toHaveProperty("created");
    const options = { publicKeyJwk: issuer.publicKeyJwk, contexts: contexts.load };
    expect(await verify(document, shown, options)).toBe(true);
    expect(await verify(document, { ...shown, created: CREATED }, options)).toBe(false);
  });

  it("rejects a proof that signed a created and no longer has it", async () => {
    const shown = await disclosure();
    const { created: _created, ...undated } = shown.proof;
    expect(await check(shown, { proof: undated })).toBe(false);
  });

  it("rejects a proof under another key than the issuer's", async () => {
    const shown = await disclosure();
    const other = await createIssuer();
    expect(await check({ ...shown, issuer: other })).toBe(false);
  });

  it("rejects a proof that is not of this suite or this type", async () => {
    const shown = await disclosure();
    expect(await check(shown, { proof: { ...shown.proof, cryptosuite: "ecdsa-rdfc-2019" } })).toBe(false);
    expect(await check(shown, { proof: { ...shown.proof, type: "Ed25519Signature2020" } })).toBe(false);
  });

  it("rejects a proof value that does not parse", async () => {
    const shown = await disclosure();
    for (const proofValue of [
      undefined,
      7,
      "",
      "u",
      "u2V0B",
      "z3abc",
      "u2V0BAAAA",
      `${String(shown.proof.proofValue)}A`,
    ]) {
      expect(await check(shown, { proof: { ...shown.proof, proofValue } })).toBe(false);
    }
  });

  it("rejects the base proof, which holds the HMAC key and every signature and never goes to a verifier", async () => {
    const { base, issuer, contexts } = await signedCredential();
    const { proof, ...document } = base;
    expect(
      await verify(document, proof as Record<string, unknown>, {
        publicKeyJwk: issuer.publicKeyJwk,
        contexts: contexts.load,
      }),
    ).toBe(false);
  });

  it("reads the proof options in the context of the document, whatever context the proof carries", async () => {
    const shown = await disclosure();
    expect(
      await check(shown, { proof: { ...shown.proof, "@context": ["https://example.test/contexts/closed/v1"] } }),
    ).toBe(true);
  });
});

describe("selectiveDisclosureSuite, given a forged disclosure", () => {
  it("rejects a signature of a statement that is not one signature for each non-mandatory statement: one too many", async () => {
    const shown = await disclosure();
    const forged = proofWith(shown, (components) => ({
      ...components,
      signatures: [...components.signatures, components.signatures[0] ?? new Uint8Array(64)],
    }));
    expect(await check(shown, { proof: forged })).toBe(false);
  });

  it("rejects one signature too few, and no signatures", async () => {
    const shown = await disclosure();
    expect(await check(shown, { proof: proofWith(shown, (c) => ({ ...c, signatures: c.signatures.slice(1) })) })).toBe(
      false,
    );
    expect(await check(shown, { proof: proofWith(shown, (c) => ({ ...c, signatures: [] })) })).toBe(false);
  });

  it("rejects when only one of the signatures of the statements is wrong", async () => {
    const shown = await disclosure();
    const strange = await (await createProofKey()).sign("<a> <b> <c> .\n");
    const forged = proofWith(shown, (components) => ({
      ...components,
      signatures: components.signatures.map((signature, index) => (index === 0 ? strange : signature)),
    }));
    expect(await check(shown, { proof: forged })).toBe(false);
  });

  it("rejects statements that the holder re-signed with a key of their own, because the issuer signed the key of the proof", async () => {
    const shown = await disclosure();
    const forgedDocument = renamed(shown.document, "Someone Else");
    const { labelMap, statements, mandatoryIndexes } = await forgedLabels(forgedDocument, shown);
    const mandatory = new Set(mandatoryIndexes);
    const attacker = await createProofKey();
    const signatures = await Promise.all(
      statements.filter((_, index) => !mandatory.has(index)).map((statement) => attacker.sign(statement)),
    );
    const resigned = proofWith(shown, (components) => ({
      ...components,
      publicKey: attacker.publicKey,
      labelMap,
      mandatoryIndexes,
      signatures,
    }));
    // The forged statements are signed by the key of the proof, which only the issuer's signature binds to the disclosure.
    expect(statements.some((statement) => statement.includes("Someone Else"))).toBe(true);
    expect(await check(shown, { document: forgedDocument, proof: resigned })).toBe(false);
  });

  it("rejects a statement that the holder moved into the mandatory ones, because the issuer signed the hash of the mandatory statements", async () => {
    const shown = await disclosure();
    const parsed = parseDerivedProofValue(shown.proof.proofValue);
    // Every statement the proof reveals, with the first one that is not mandatory marked as mandatory and its signature dropped.
    const statements = await statementsOf(shown.document, parsed.labelMap);
    const first = statements.findIndex((_, index) => !parsed.mandatoryIndexes.includes(index));
    expect(first).toBeGreaterThanOrEqual(0);
    const forged = proofWith(shown, (components) => ({
      ...components,
      mandatoryIndexes: [...components.mandatoryIndexes, first].sort((a, b) => a - b),
      signatures: components.signatures.slice(1),
    }));
    expect(await check(shown, { proof: forged })).toBe(false);
  });

  it("rejects mandatory positions that are not ascending, repeat or lie beyond the statements", async () => {
    const shown = await disclosure();
    for (const mandatoryIndexes of [
      [1, 0],
      [0, 0],
      [0, 10_000],
    ]) {
      expect(await check(shown, { proof: proofWith(shown, (c) => ({ ...c, mandatoryIndexes })) })).toBe(false);
    }
    const reversed = proofWith(shown, (c) => ({ ...c, mandatoryIndexes: [...c.mandatoryIndexes].reverse() }));
    expect(await check(shown, { proof: reversed })).toBe(false);
  });

  it("rejects a label map that lacks a blank node", async () => {
    const shown = await disclosure();
    expect(await check(shown, { proof: proofWith(shown, (c) => ({ ...c, labelMap: new Map() })) })).toBe(false);
  });

  it("rejects a public key that is no point of the curve", async () => {
    const shown = await disclosure();
    const bad = Uint8Array.of(0x80, 0x24, 0xff, ...new Uint8Array(32));
    expect(await check(shown, { proof: proofWith(shown, (c) => ({ ...c, publicKey: bad })) })).toBe(false);
  });
});

describe("selectiveDisclosureSuite, given a key that cannot verify", () => {
  it("answers false for a key of another curve or kind, or a point that is not on the curve", async () => {
    const shown = await disclosure();
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
    for (const publicKeyJwk of [
      await crypto.subtle.exportKey("jwk", other.publicKey),
      { kty: "OKP", crv: "Ed25519", x: "AAAA" },
      { kty: "EC", crv: "P-256", x: "AAAA", y: "AAAA" },
      {},
    ]) {
      expect(await verify(shown.document, shown.proof, { publicKeyJwk, contexts: shown.contexts.load })).toBe(false);
    }
  });

  it("throws for a key that holds a private key, which is a mistake of the caller", async () => {
    const shown = await disclosure();
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    await expect(
      verify(shown.document, shown.proof, {
        publicKeyJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
        contexts: shown.contexts.load,
      }),
    ).rejects.toThrow("holds a private key (d)");
  });
});

describe("selectiveDisclosureSuite, given more than it will read", () => {
  it("answers false for a document with its proof larger than maxBytes, and true at the limit", async () => {
    const shown = await disclosure();
    const size =
      new TextEncoder().encode(JSON.stringify(shown.document)).length +
      new TextEncoder().encode(JSON.stringify(shown.proof)).length;
    expect(await check(shown, { maxBytes: size })).toBe(true);
    expect(await check(shown, { maxBytes: size - 1 })).toBe(false);
  });

  it("answers false for a document with its proof of more tokens than maxTokens, and true at the limit", async () => {
    const shown = await disclosure();
    const tokens = tokensOf(JSON.stringify(shown.document) + JSON.stringify(shown.proof));
    expect(await check(shown, { maxTokens: tokens })).toBe(true);
    expect(await check(shown, { maxTokens: tokens - 1 })).toBe(false);
  });

  it("answers false for a document of more than 20,000 tokens unless the caller sets another limit", async () => {
    const shown = await disclosure();
    // The proof property of the document is not what the proof covers, but it counts towards the limits.
    const padded = { ...shown.document, proof: Array.from({ length: 10_000 }, (_, index) => index) };
    expect(await check(shown, { document: padded })).toBe(false);
    expect(await check(shown, { document: padded, maxTokens: 30_000 })).toBe(true);
  });

  it("answers false for a document that is not JSON or nests too deep", async () => {
    const shown = await disclosure();
    let nested: Record<string, unknown> = {};
    for (let level = 0; level < 70; level += 1) nested = { next: nested };
    expect(await check(shown, { document: { ...shown.document, nested } })).toBe(false);
    expect(await check(shown, { document: { ...shown.document, value: undefined } })).toBe(false);
    expect(await check(shown, { proof: { ...shown.proof, value: () => 1 } })).toBe(false);
  });

  it("answers false for a document without an @context, or whose terms the contexts do not define", async () => {
    const shown = await disclosure();
    const { "@context": _context, ...bare } = shown.document;
    expect(await check(shown, { document: bare })).toBe(false);
    expect(
      await check(shown, { document: { ...shown.document, "@context": ["https://example.test/contexts/closed/v1"] } }),
    ).toBe(false);
  });
});

describe("selectiveDisclosureSuite, given arguments of other types", () => {
  it("throws for options that are not an object", async () => {
    const shown = await disclosure();
    for (const bad of [null, undefined, "options", 7, []]) {
      await expect(verify(shown.document, shown.proof, bad as never)).rejects.toThrow(DataError);
    }
  });

  it("throws for a document, a proof or a key that is not an object", async () => {
    const shown = await disclosure();
    const options = { publicKeyJwk: shown.issuer.publicKeyJwk, contexts: shown.contexts.load };
    for (const bad of [null, undefined, "x", 7, [shown.document]]) {
      await expect(verify(bad as never, shown.proof, options)).rejects.toThrow(/The document must be an object/);
      await expect(verify(shown.document, bad as never, options)).rejects.toThrow(/The proof must be an object/);
      await expect(verify(shown.document, shown.proof, { ...options, publicKeyJwk: bad as never })).rejects.toThrow(
        /The option publicKeyJwk must be an object/,
      );
    }
    await expect(
      verify(shown.document, shown.proof, JSON.parse('{"publicKeyJwk":{},"contexts":"https://example.test"}')),
    ).rejects.toThrow(/The option contexts must be a function/);
    await expect(verify(shown.document, shown.proof, { ...options, maxBytes: 0 })).rejects.toThrow(
      /maxBytes must be a positive integer/,
    );
    await expect(verify(shown.document, shown.proof, { ...options, maxTokens: 2.5 })).rejects.toThrow(
      /maxTokens must be a positive integer/,
    );
    await expect(verify(shown.document, shown.proof, { ...options, signal: 1 as never })).rejects.toThrow(
      /signal must be an AbortSignal/,
    );
  });
});

describe("selectiveDisclosureSuite, when the context loader fails or the caller gives up", () => {
  it("passes on the error of the loader instead of answering false, even when it is a DataError", async () => {
    const shown = await disclosure();
    for (const failure of [new Error("The network is down."), new DataError("The pin does not match.")]) {
      await expect(
        verify(shown.document, shown.proof, {
          publicKeyJwk: shown.issuer.publicKeyJwk,
          contexts: () => Promise.reject(failure),
        }),
      ).rejects.toBe(failure);
    }
  });

  it("ends the wait with the reason of the signal when the loader never answers", async () => {
    const shown = await disclosure();
    const controller = new AbortController();
    const contexts = hangingContexts();
    const pending = verify(shown.document, shown.proof, {
      publicKeyJwk: shown.issuer.publicKeyJwk,
      contexts: contexts.load,
      signal: controller.signal,
    });
    const reason = new Error("The caller gave up.");
    await contexts.asked;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("does not start when the signal has aborted", async () => {
    const shown = await disclosure();
    const controller = new AbortController();
    const reason = new Error("Already aborted.");
    controller.abort(reason);
    const contexts = memoryContexts();
    await expect(
      verify(shown.document, shown.proof, {
        publicKeyJwk: shown.issuer.publicKeyJwk,
        contexts: contexts.load,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(contexts.requested).toStrictEqual([]);
  });
});
