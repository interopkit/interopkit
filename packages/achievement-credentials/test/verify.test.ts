import { readFileSync } from "node:fs";
import { DataError, ServiceError, signCompactJws } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { addProof } from "../src/data-integrity/index.js";
import { type IssuableCredential, type KeyResolver, VERIFICATION_CHECKS } from "../src/index.js";
import { signCredentialJwt } from "../src/jwt/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { verifyCredential } from "../src/verify/index.js";
import { memoryContexts } from "./context-fixtures.js";
import { achievementCredential, achievementCredentialV1p1, PROFILE } from "./fixtures.js";
import { abortsWhileWaiting, hangingPort } from "./hanging-port.js";
import { HOSTILE, neverParsesLarge } from "./hostile.js";
import { clockAt, KEYS, serve, signerOf } from "./key-fixtures.js";
import { ISSUER, METHOD, NOW, world } from "./status-fixtures.js";
import { ALL_PASSED, badge, detailOf, encoder, forge, jwsOf, outcomes } from "./verify-fixtures.js";

describe("verifying a credential in a compact JWS", () => {
  it("passes every check that applies, and returns what the proof secures", async () => {
    const { options } = world();
    const result = await verifyCredential(await jwsOf(), options);
    expect(result.verified).toBe(true);
    expect(outcomes(result)).toStrictEqual(ALL_PASSED);
    expect(result.credential).toMatchObject({ id: "https://example.edu/credentials/1" });
    expect(result.endorsements).toStrictEqual([]);
    expect(result.nested).toStrictEqual([]);
  });

  it("lists every check in the order of Open Badges 9, with a detail that says what was found", async () => {
    const { options } = world();
    const result = await verifyCredential(await jwsOf(), options);
    expect(result.checks.map(({ check }) => check)).toStrictEqual([...VERIFICATION_CHECKS]);
    expect(result.checks.every(({ detail }) => detail.length > 10)).toBe(true);
  });

  it("verifies the same credential from what readPng and readSvg return", async () => {
    const { options } = world();
    const baked = { kind: "badge", credential: await jwsOf() };
    expect((await verifyCredential(baked, options)).verified).toBe(true);
  });

  it("verifies a credential of Data Model 1.1, with the names issuanceDate and expirationDate", async () => {
    const { options } = world();
    const credential = { ...achievementCredentialV1p1(), expirationDate: "2030-01-01T00:00:00Z" };
    const jws = await forge({ ...credential, iss: ISSUER, jti: "https://example.edu/credentials/1" }, KEYS.es256);
    const result = await verifyCredential(jws, options);
    expect(outcomes(result)).toStrictEqual(ALL_PASSED);
    const expired = await forge({ ...credential, expirationDate: "2024-06-14T11:00:00Z" }, KEYS.es256);
    expect(await verifyCredential(expired, options)).toMatchObject({ verified: false });
  });
});

/** Options of the wrong type or value, each as a host might pass it. */
const BAD_OPTIONS: readonly (readonly [string, unknown])[] = [
  ["contexts", "loader"],
  ["fetch", "fetch"],
  ["statusLists", "cache"],
  ["statusLists", { get: "get" }],
  ["statusIssuers", "issuer"],
  ["statusIssuers", [7]],
  ["recipient", "someone"],
  ["recipient", {}],
  ["recipient", { id: 7 }],
  ["recipient", { identifier: "mail" }],
  ["recipient", { identifier: { type: "emailAddress" } }],
  ["refresh", "yes"],
  ["unavailable", "ignore"],
  ["legacyProofs", 1],
  ["allowUnboundKeys", "yes"],
  ["algorithms", "ES256"],
  ["clockSkewSeconds", -1],
  ["maxEndorsements", 0],
  ["maxNestedCredentials", "many"],
  ["maxInputBytes", 0],
  ["maxDepth", 1.5],
  ["maxTokens", 0],
  ["timeoutMs", 0],
  ["maxBytes", -5],
  ["suites", "suite"],
  ["suites", [{ cryptosuite: "", verify: () => true }]],
  ["suites", [{ verify: () => true }]],
  ["signal", "abort"],
];

describe("the input", () => {
  it.each([
    ["null", null],
    ["a number", 7],
    ["an array", []],
    ["undefined", undefined],
  ])("is refused as a value that is neither a string nor an object: %s", async (_name, input) => {
    await expect(verifyCredential(input as never, world().options)).rejects.toThrow(DataError);
  });

  it.each([
    ["no options", undefined],
    ["null options", null],
    ["a string for the options", "options"],
    ["a string for keys", { keys: "keys", clock: clockAt(NOW) }],
    ["a string for the clock", { keys: createKeyResolver({ clock: clockAt(NOW) }), clock: "now" }],
  ])("is refused, as is %s", async (_name, options) => {
    await expect(verifyCredential(await jwsOf(), options as never)).rejects.toThrow(DataError);
  });

  it.each(BAD_OPTIONS)("is refused with a bad option %s", async (name, value) => {
    const { options } = world();
    await expect(verifyCredential(await jwsOf(), { ...options, [name]: value } as never)).rejects.toThrow(DataError);
  });

  it("is refused when a string is neither a compact JWS nor an address, without running a regular expression over it", async () => {
    const { options } = world();
    const result = await verifyCredential("not a credential", options);
    expect(result.verified).toBe(false);
    expect(outcomes(result)).toMatchObject({ format: "failed", proof: "skipped" });
    expect(detailOf(result, "format")).toContain("parse JSON text");
  });

  it("is refused when a string is longer than maxInputBytes, whatever it is, before anything reads it", async () => {
    const result = await verifyCredential("x".repeat(20), { ...world().options, maxInputBytes: 10 });
    expect(outcomes(result).format).toBe("failed");
    expect(detailOf(result, "format")).toContain("20 characters");
  });

  it("takes an address as a hosted Open Badges 2.0 assertion, which it fetches", async () => {
    const { options, requests } = world();
    const result = await verifyCredential("https://example.org/assertions/1", options);
    expect(outcomes(result).proof).toBe("unavailable");
    expect(detailOf(result, "proof")).toContain("The hosted assertion");
    expect(requests).toContain("https://example.org/assertions/1");
  });

  it("is refused when a JWS is longer than maxInputBytes, before it is looked at", async () => {
    const { options } = world();
    const jws = await jwsOf();
    const result = await verifyCredential(jws, { ...options, maxInputBytes: jws.length - 1 });
    expect(outcomes(result).format).toBe("failed");
    expect(detailOf(result, "format")).toContain("characters");
  });

  it("is refused when an object is over maxInputBytes, maxTokens or maxDepth, before a reader or a key is reached", async () => {
    const { options, requests } = world();
    const credential = { ...achievementCredential(), proof: [{ type: "DataIntegrityProof" }] };
    for (const limit of [{ maxInputBytes: 100 }, { maxTokens: 20 }, { maxDepth: 3 }]) {
      const result = await verifyCredential(credential, { ...options, ...limit });
      expect(outcomes(result)).toMatchObject({ format: "failed", proof: "skipped" });
    }
    expect(requests).toStrictEqual([]);
  });

  it("is refused when an object is not JSON, such as one that holds itself", async () => {
    const cyclic: Record<string, unknown> = { type: ["VerifiableCredential"] };
    cyclic.self = cyclic;
    const result = await verifyCredential(cyclic, world().options);
    expect(detailOf(result, "format")).toContain("is not JSON");
  });

  it("is refused for a JWS whose payload has more tokens than it may, without parsing it", async () => {
    const { options } = world();
    const jws = await signCompactJws({ typ: "JWT", kid: METHOD }, encoder.encode(HOSTILE), signerOf(KEYS.es256));
    const result = await neverParsesLarge(() => verifyCredential(jws, { ...options, maxInputBytes: 10_000_000 }));
    expect(outcomes(result)).toMatchObject({ format: "failed" });
    expect(detailOf(result, "format")).toContain("tokens");
  });

  it("is refused when it is a credential of another class, or no credential", async () => {
    const { options } = world();
    const other = await verifyCredential({ ...achievementCredential(), type: ["VerifiableCredential"] }, options);
    expect(detailOf(other, "format")).toContain("is not an AchievementCredential");
    const none = await verifyCredential({ hello: "world" }, options);
    expect(outcomes(none).format).toBe("failed");
  });
});

describe("the inputs of Open Badges 2.0", () => {
  const fixture: {
    readonly documents: Readonly<Record<string, { readonly body?: unknown }>>;
    readonly cases: readonly { readonly name: string; readonly input: unknown }[];
  } = JSON.parse(readFileSync(new URL("./fixtures/open-badges-2/badges.json", import.meta.url), "utf8"));

  it("are verified as Open Badges 2.0, which fetches their documents: an address, an assertion and a JWS alike", async () => {
    const { options, requests } = world();
    const inputs = [
      ...fixture.cases.map(({ input }) => input),
      fixture.documents["https://badges.example.org/assertions/1"]?.body,
    ];
    expect(inputs.length).toBeGreaterThan(5);
    for (const input of inputs) {
      // The host of these options serves none of the documents of the badges, so none can be had.
      const result = await verifyCredential(input as string | object, options);
      expect(result.verified).toBe(false);
      expect(result.credential).toBeUndefined();
      expect(result.checks).toHaveLength(VERIFICATION_CHECKS.length);
      expect(outcomes(result).proof).toBe("unavailable");
    }
    expect(requests.some((url) => url.startsWith("https://badges.example.org"))).toBe(true);
  });
});

describe("the proof of a credential in a JWS", () => {
  it("fails when the signature is not the key's, and nothing that the credential names is fetched", async () => {
    const { options, requests } = world();
    const credential = {
      ...badge(),
      credentialStatus: { id: "https://example.edu/s#1", type: "BitstringStatusListEntry" },
    };
    const jws = await forge({ ...credential, iss: ISSUER }, KEYS.other);
    const result = await verifyCredential(jws, options);
    expect(result.verified).toBe(false);
    expect(result.credential).toBeUndefined();
    expect(outcomes(result)).toMatchObject({ format: "passed", proof: "failed", issuer: "skipped", status: "skipped" });
    expect(detailOf(result, "status")).toContain("Not run: the check of the proof did not pass.");
    expect(requests.filter((url) => url !== ISSUER)).toStrictEqual([]);
  });

  it("passes through an error that is not a failed service, which is a bug of the resolver and no verdict on the credential", async () => {
    const { options } = world();
    const keys = {
      resolve: async () => {
        throw new TypeError("a bug of the resolver");
      },
      issuerKeys: async () => [],
    };
    await expect(verifyCredential(await jwsOf(), { ...options, keys })).rejects.toThrow(TypeError);
  });

  it("fails for an algorithm that the options leave out", async () => {
    const { options } = world();
    const result = await verifyCredential(await jwsOf(), { ...options, algorithms: ["ES384"] });
    expect(outcomes(result).proof).toBe("failed");
    expect(detailOf(result, "proof")).toContain("ES256");
  });

  it("is unavailable when the key cannot be read, and that fails the verification whatever unavailable says", async () => {
    const { options } = world({ [ISSUER]: 503 });
    const jws = await jwsOf();
    for (const unavailable of ["fail", "warn"] as const) {
      const result = await verifyCredential(jws, { ...options, unavailable });
      expect(result.verified).toBe(false);
      expect(outcomes(result)).toMatchObject({ proof: "unavailable", issuer: "skipped" });
    }
  });

  it("is the validity of the credential, and not its proof, when the time claims are off", async () => {
    const { options } = world();
    const early = await verifyCredential(await jwsOf({ ...badge(), validFrom: "2024-06-14T13:00:00Z" }), options);
    expect(outcomes(early)).toMatchObject({ proof: "passed", issuer: "passed", validity: "failed" });
    expect(early.verified).toBe(false);
    expect(early.credential).toBeDefined();
    const late = await verifyCredential(await jwsOf({ ...badge(), validUntil: "2024-06-14T11:00:00Z" }), options);
    expect(outcomes(late)).toMatchObject({ proof: "passed", validity: "failed" });
    expect(detailOf(late, "validity")).toContain("expired");
  });

  it("allows the skew of the clock at both ends of the validity", async () => {
    const { options } = world();
    const edge = await jwsOf({ ...badge(), validFrom: "2024-06-14T12:00:59Z", validUntil: "2024-06-14T12:30:00Z" });
    expect((await verifyCredential(edge, options)).verified).toBe(true);
    expect((await verifyCredential(edge, { ...options, clockSkewSeconds: 0 })).verified).toBe(false);
  });
});

describe("the issuer's hold on the key", () => {
  it("fails a good signature by a key that the issuer does not publish, and withholds the credential", async () => {
    const { options } = world();
    const jws = await signCredentialJwt(badge(), signerOf(KEYS.other), { jwk: KEYS.other.publicJwk });
    const result = await verifyCredential(jws, options);
    expect(outcomes(result)).toMatchObject({ proof: "passed", issuer: "failed", refresh: "skipped" });
    expect(result.verified).toBe(false);
    expect(result.credential).toBeUndefined();
  });

  it("fails an embedded key of one issuer under a credential of another", async () => {
    const { options } = world();
    const other = { ...badge(), issuer: { ...PROFILE, id: "https://other.example/issuers/9" } };
    const jws = await signCredentialJwt(other as IssuableCredential, signerOf(KEYS.es256), {
      jwk: KEYS.es256.publicJwk,
    });
    expect(outcomes(await verifyCredential(jws, options))).toMatchObject({ proof: "passed", issuer: "failed" });
  });

  it("fails a key that the issuer lists under another relationship than assertionMethod", async () => {
    const document = {
      id: ISSUER,
      verificationMethod: [{ id: METHOD, type: "JsonWebKey", controller: ISSUER, publicKeyJwk: KEYS.es256.publicJwk }],
      authentication: [METHOD],
    };
    const { options } = world({ [ISSUER]: document });
    expect(outcomes(await verifyCredential(await jwsOf(), options)).issuer).toBe("failed");
  });

  it("fails a key of a JWK Set whose iss names another issuer", async () => {
    const jwk = { ...KEYS.other.publicJwk, kid: "k", iss: "https://badges.example/issuers/2" };
    const { options } = world({ "https://example.edu/.well-known/jwks.json": { keys: [jwk] } });
    const jws = await signCredentialJwt(badge(), signerOf(KEYS.other), { jwk: KEYS.other.publicJwk });
    expect(outcomes(await verifyCredential(jws, options)).issuer).toBe("failed");
  });

  it("is skipped with allowUnboundKeys, which the result says, and the credential is returned", async () => {
    const { options } = world();
    const jws = await signCredentialJwt(badge(), signerOf(KEYS.other), { jwk: KEYS.other.publicJwk });
    const result = await verifyCredential(jws, { ...options, allowUnboundKeys: true });
    expect(outcomes(result).issuer).toBe("skipped");
    expect(detailOf(result, "issuer")).toContain("allowUnboundKeys");
    expect(result.verified).toBe(true);
    expect(result.credential).toBeDefined();
  });

  it("is unavailable when what the issuer publishes cannot be read, and unavailable says whether that fails", async () => {
    const jws = await signCredentialJwt(badge(), signerOf(KEYS.other), { jwk: KEYS.other.publicJwk });
    const { options } = world({ [ISSUER]: 503, "https://example.edu/.well-known/jwks.json": 503 });
    const failing = await verifyCredential(jws, options);
    expect(outcomes(failing)).toMatchObject({ proof: "passed", issuer: "unavailable" });
    expect(failing.verified).toBe(false);
    const warning = await verifyCredential(jws, { ...options, unavailable: "warn" });
    expect(warning.verified).toBe(true);
    expect(outcomes(warning).issuer).toBe("unavailable");
  });
});

describe("verifying a credential with a Data Integrity proof", () => {
  const did = `did:key:${KEYS.ed25519.multikey}`;
  const method = `${did}#${KEYS.ed25519.multikey}`;
  const sign = async (credential: unknown = undefined) => {
    const contexts = memoryContexts();
    const clock = clockAt(NOW);
    const value = credential ?? { ...achievementCredential(), issuer: { id: did, type: ["Profile"] } };
    const signed = await addProof(value as IssuableCredential, signerOf(KEYS.ed25519, method), {
      clock,
      contexts: contexts.load,
    });
    return { signed, contexts, options: { keys: createKeyResolver({ clock }), clock, contexts: contexts.load } };
  };

  it("passes with a did:key issuer, which publishes its own key", async () => {
    const { signed, options } = await sign();
    const result = await verifyCredential(signed, options);
    expect(outcomes(result)).toStrictEqual(ALL_PASSED);
    expect(result.verified).toBe(true);
  });

  it("is judged for its validity by the credential's own dates, which no time claim says for this kind of proof", async () => {
    const issuer = { id: did, type: ["Profile"] };
    const early = await sign({ ...achievementCredential(), issuer, validFrom: "2024-06-14T13:00:00Z" });
    const result = await verifyCredential(early.signed, early.options);
    expect(outcomes(result)).toMatchObject({ proof: "passed", issuer: "passed", validity: "failed" });
    expect(detailOf(result, "validity")).toContain("not valid before");
    const late = await sign({ ...achievementCredential(), issuer, validUntil: "2024-06-14T11:00:00Z" });
    expect(detailOf(await verifyCredential(late.signed, late.options), "validity")).toContain("expired");
  });

  it("fails with a reason that names maxJsonLdTokens for a credential of more tokens than the processors may read", async () => {
    const { signed, options, contexts } = await sign();
    contexts.requested.length = 0;
    const result = await verifyCredential(signed, { ...options, maxJsonLdTokens: 50 });
    expect(outcomes(result)).toMatchObject({ format: "passed", proof: "failed", issuer: "skipped" });
    expect(detailOf(result, "proof")).toContain("maxJsonLdTokens");
    expect(contexts.requested).toStrictEqual([]);
    expect(outcomes(await verifyCredential(signed, options)).proof).toBe("passed");
  });

  it("is unavailable without a loader of contexts, and nothing is loaded", async () => {
    const { signed, options } = await sign();
    const { contexts: _unused, ...withoutContexts } = options;
    const result = await verifyCredential(signed, withoutContexts);
    expect(outcomes(result)).toMatchObject({ proof: "unavailable" });
    expect(detailOf(result, "proof")).toContain("contexts");
    expect(result.verified).toBe(false);
  });

  it("fails a credential that has no proof, and a proof that does not verify", async () => {
    const { signed, options } = await sign();
    const { proof: _proof, ...unsigned } = signed as unknown as Record<string, unknown>;
    expect(outcomes(await verifyCredential(unsigned, options)).proof).toBe("failed");
    const tampered = { ...signed, name: "Changed" };
    expect(outcomes(await verifyCredential(tampered, options)).proof).toBe("failed");
  });

  it("is unavailable for a cryptosuite that no suite verifies, and a suite of the options verifies it", async () => {
    const { signed, options } = await sign();
    const proofs = (signed as unknown as { proof: Record<string, unknown>[] }).proof;
    const foreign = { ...signed, proof: [{ ...proofs[0], cryptosuite: "eddsa-jcs-2022" }] };
    const result = await verifyCredential(foreign, options);
    expect(outcomes(result).proof).toBe("unavailable");
    let seen: string | undefined;
    const suites = [
      {
        cryptosuite: "eddsa-jcs-2022",
        verify: async (_document: unknown, proof: Readonly<Record<string, unknown>>) => {
          seen = String(proof.cryptosuite);
          return true;
        },
      },
    ];
    const accepted = await verifyCredential(foreign, { ...options, suites });
    expect(seen).toBe("eddsa-jcs-2022");
    expect(accepted.verified).toBe(true);
  });

  it("is unavailable when a context cannot be read, and a suite that throws is the host's fault and passes through", async () => {
    const { signed, options } = await sign();
    const contexts = async () => {
      throw new ServiceError("The context is down.", 503, "");
    };
    const down = await verifyCredential(signed, { ...options, contexts });
    expect(outcomes(down).proof).toBe("unavailable");
    expect(detailOf(down, "proof")).toContain("could not be read");
    const proofs = (signed as unknown as { proof: Record<string, unknown>[] }).proof;
    const foreign = { ...signed, proof: [{ ...proofs[0], cryptosuite: "eddsa-jcs-2022" }] };
    const broken = {
      cryptosuite: "eddsa-jcs-2022",
      verify: async () => {
        throw new TypeError("a bug of the host");
      },
    };
    await expect(verifyCredential(foreign, { ...options, suites: [broken] })).rejects.toThrow(TypeError);
  });

  it("fails a key that the issuer does not hold, as the key of a JWS is judged", async () => {
    const { signed, options } = await sign({
      ...achievementCredential(),
      issuer: { id: `did:key:${KEYS.otherEd25519.multikey}`, type: ["Profile"] },
    });
    const result = await verifyCredential(signed, options);
    expect(outcomes(result)).toMatchObject({ proof: "passed", issuer: "failed" });
    expect(result.credential).toBeUndefined();
  });
});

describe("the options that unavailable and the signal govern", () => {
  it("rejects with the reason of a signal that has aborted, before a key is read", async () => {
    const { options, requests } = world();
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(verifyCredential(await jwsOf(), { ...options, signal: controller.signal })).rejects.toThrow("stop");
    expect(requests).toStrictEqual([]);
  });

  describe("with a port of the host that never answers", () => {
    /** A resolver whose methods are the real ones except for the named one, which never settles. */
    const hangingAt = (real: KeyResolver, method: "resolve" | "issuerKeys") => {
      const { hang, seen } = hangingPort();
      const keys: KeyResolver =
        method === "resolve"
          ? { resolve: hang, issuerKeys: real.issuerKeys }
          : { resolve: real.resolve, issuerKeys: hang };
      return { keys, seen };
    };
    const did = `did:key:${KEYS.ed25519.multikey}`;
    const method = `${did}#${KEYS.ed25519.multikey}`;
    /** A credential of the did:key issuer with a Data Integrity proof, and the options that verify it. */
    const signedByDid = async () => {
      const contexts = memoryContexts();
      const clock = clockAt(NOW);
      const signed = await addProof(
        { ...achievementCredential(), issuer: { id: did, type: ["Profile"] } } as unknown as IssuableCredential,
        signerOf(KEYS.ed25519, method),
        { clock, contexts: contexts.load },
      );
      return { signed, clock, contexts, keys: createKeyResolver({ clock }) };
    };

    it("ends the wait for the key of a JWS when the signal aborts", async () => {
      const { options } = world();
      const { keys, seen } = hangingAt(options.keys, "resolve");
      const jws = await jwsOf();
      await abortsWhileWaiting((signal) => verifyCredential(jws, { ...options, keys, signal }), seen);
    });

    it("ends the wait for the key of a Data Integrity proof when the signal aborts", async () => {
      const { signed, clock, contexts, keys: real } = await signedByDid();
      const { keys, seen } = hangingAt(real, "resolve");
      await abortsWhileWaiting(
        (signal) => verifyCredential(signed, { keys, clock, contexts: contexts.load, signal }),
        seen,
      );
    });

    it("ends the wait for what the issuer publishes when the signal aborts", async () => {
      const { options } = world();
      const { keys, seen } = hangingAt(options.keys, "issuerKeys");
      const jws = await jwsOf();
      await abortsWhileWaiting((signal) => verifyCredential(jws, { ...options, keys, signal }), seen);
    });

    it("ends the wait for a context when the signal aborts", async () => {
      const { signed, clock, keys } = await signedByDid();
      const { hang, seen } = hangingPort();
      await abortsWhileWaiting((signal) => verifyCredential(signed, { keys, clock, contexts: hang, signal }), seen);
    });

    it("ends the wait for a suite of the host when the signal aborts", async () => {
      const { signed, clock, contexts, keys } = await signedByDid();
      const { hang, seen } = hangingPort();
      const suites = [{ cryptosuite: "eddsa-rdfc-2022", verify: hang as never }];
      await abortsWhileWaiting(
        (signal) => verifyCredential(signed, { keys, clock, contexts: contexts.load, suites, signal }),
        seen,
      );
    });
  });

  it("serves a call with the routes that the credential needs and no others", async () => {
    const { fetch, requests } = serve({});
    const clock = clockAt(NOW);
    const keys = createKeyResolver({ clock, fetch });
    const did = `did:key:${KEYS.ed25519.multikey}`;
    const jws = await signCredentialJwt(
      { ...badge(), issuer: { id: did, type: ["Profile"] } } as IssuableCredential,
      signerOf(KEYS.ed25519),
      { kid: `${did}#${KEYS.ed25519.multikey}` },
    );
    const result = await verifyCredential(jws, { keys, clock });
    expect(result.verified).toBe(true);
    expect(requests).toStrictEqual([]);
  });
});
