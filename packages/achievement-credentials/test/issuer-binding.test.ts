import { DataError, ServiceError } from "@interopkit/core";
import { base64url } from "jose";
import { describe, expect, it } from "vitest";
import type { KeyResolver, VerificationKey } from "../src/index.js";
import { createKeyResolver, verifyIssuerKey } from "../src/keys/index.js";
import { clockAt, KEYS, serve } from "./key-fixtures.js";

const ISSUER = "https://example.edu/issuers/1";
const PLATFORM_ISSUER = "https://badges.example/issuers/2";
const SET_URL = "https://example.edu/.well-known/jwks.json";
const PLATFORM_SET = "https://badges.example/.well-known/jwks.json";

/** A key as a resolver gives it: the key material of a test key under the given fields. */
function keyOf(material: { publicJwk: JsonWebKey }, fields: Partial<VerificationKey> = {}): VerificationKey {
  return { id: "https://example.edu/keys/1", publicKeyJwk: material.publicJwk, relationships: [], ...fields };
}

/** The controller document of the issuer, which lists the key of the material under the given relationships. */
function controllerDocument(material: { publicJwk: JsonWebKey }, relationships: readonly string[]) {
  const id = `${ISSUER}#key-1`;
  return {
    id: ISSUER,
    verificationMethod: [{ id, type: "JsonWebKey", controller: ISSUER, publicKeyJwk: material.publicJwk }],
    ...Object.fromEntries(relationships.map((relationship) => [relationship, [id]])),
  };
}

function resolverFor(routes: Record<string, unknown>) {
  return createKeyResolver({ clock: clockAt(0), fetch: serve(routes).fetch });
}

describe("a key that the issuer publishes", () => {
  it("is bound when the controller document lists it under assertionMethod", async () => {
    const keys = resolverFor({ [ISSUER]: controllerDocument(KEYS.es256, ["assertionMethod"]) });
    const key = keyOf(KEYS.es256, { id: `${ISSUER}#key-1`, controller: ISSUER });
    expect(await verifyIssuerKey(key, ISSUER, { keys })).toMatchObject({ check: "issuer", outcome: "passed" });
  });

  it("is bound when it is a bare JWK that the issuer publishes, whatever its address", async () => {
    const keys = resolverFor({ [ISSUER]: controllerDocument(KEYS.es256, ["assertionMethod"]) });
    expect((await verifyIssuerKey(keyOf(KEYS.es256), ISSUER, { keys })).outcome).toBe("passed");
  });

  it("is bound when the JWK Set of the host lists it", async () => {
    const keys = resolverFor({ [SET_URL]: { keys: [{ ...KEYS.rs256.publicJwk, kid: "k" }] } });
    expect((await verifyIssuerKey(keyOf(KEYS.rs256), ISSUER, { keys })).outcome).toBe("passed");
  });

  it("is bound when the issuer is the did:key that holds it", async () => {
    const did = `did:key:${KEYS.ed25519.multikey}`;
    const keys = createKeyResolver({ clock: clockAt(0) });
    const key = await keys.resolve(`${did}#${KEYS.ed25519.multikey}`);
    expect(key).toBeDefined();
    expect((await verifyIssuerKey(key as VerificationKey, did, { keys })).outcome).toBe("passed");
  });

  it("is bound when the issuer is the did:jwk that holds it, and not for another key", async () => {
    const did = `did:jwk:${base64url.encode(JSON.stringify(KEYS.es256.publicJwk))}`;
    const keys = createKeyResolver({ clock: clockAt(0) });
    expect((await verifyIssuerKey(keyOf(KEYS.es256), did, { keys })).outcome).toBe("passed");
    expect((await verifyIssuerKey(keyOf(KEYS.other), did, { keys })).outcome).toBe("failed");
  });

  it("is bound when the issuer is a did:web whose document lists it under assertionMethod", async () => {
    const did = "did:web:example.edu";
    const document = {
      id: did,
      verificationMethod: [{ id: `${did}#k`, controller: did, publicKeyMultibase: KEYS.ed25519.multikey }],
      assertionMethod: [`${did}#k`],
    };
    const keys = resolverFor({ "https://example.edu/.well-known/did.json": document });
    const key = await keys.resolve(`${did}#k`);
    expect((await verifyIssuerKey(key as VerificationKey, did, { keys })).outcome).toBe("passed");
  });
});

describe("a forged issuer", () => {
  it("is refused when the signature is good and the key is none that the issuer publishes", async () => {
    const keys = resolverFor({ [ISSUER]: controllerDocument(KEYS.es256, ["assertionMethod"]) });
    const check = await verifyIssuerKey(keyOf(KEYS.other), ISSUER, { keys });
    expect(check).toMatchObject({ check: "issuer", outcome: "failed" });
    expect(check.detail).toContain("does not publish");
  });

  it("is refused when an embedded key is the key of another issuer", async () => {
    const keys = resolverFor({
      [ISSUER]: controllerDocument(KEYS.es256, ["assertionMethod"]),
      "https://other.example/issuers/9": { id: "https://other.example/issuers/9" },
    });
    expect((await verifyIssuerKey(keyOf(KEYS.es256), "https://other.example/issuers/9", { keys })).outcome).toBe(
      "failed",
    );
  });

  it("is refused when a self-describing method is none that the document of the issuer lists", async () => {
    const keys = resolverFor({ [ISSUER]: controllerDocument(KEYS.es256, ["assertionMethod"]) });
    const forged = keyOf(KEYS.other, { id: `${ISSUER}#z6MkForgedKey`, controller: ISSUER });
    expect((await verifyIssuerKey(forged, ISSUER, { keys })).outcome).toBe("failed");
  });

  it("is refused when the key of the method is listed with no relationship, or only for authentication", async () => {
    for (const relationships of [[], ["authentication"], ["capabilityInvocation"]]) {
      const keys = resolverFor({ [ISSUER]: controllerDocument(KEYS.es256, relationships) });
      const key = keyOf(KEYS.es256, { controller: ISSUER });
      expect((await verifyIssuerKey(key, ISSUER, { keys })).outcome, relationships.join()).toBe("failed");
    }
  });

  it("is refused when a method names another controller, although the issuer publishes the same key", async () => {
    const keys = resolverFor({ [ISSUER]: controllerDocument(KEYS.es256, ["assertionMethod"]) });
    const key = keyOf(KEYS.es256, { controller: "https://other.example/issuers/9" });
    const check = await verifyIssuerKey(key, ISSUER, { keys });
    expect(check.outcome).toBe("failed");
    expect(check.detail).toContain("controlled by https://other.example/issuers/9");
  });

  it("is refused when the member of the JWK Set names another issuer in its iss", async () => {
    // Two issuers of one platform share its key set; the iss member tells whose key a member is.
    const keys = resolverFor({
      [PLATFORM_SET]: { keys: [{ ...KEYS.es256.publicJwk, kid: "k", iss: PLATFORM_ISSUER }] },
    });
    expect((await verifyIssuerKey(keyOf(KEYS.es256), "https://badges.example/issuers/1", { keys })).outcome).toBe(
      "failed",
    );
    expect((await verifyIssuerKey(keyOf(KEYS.es256), PLATFORM_ISSUER, { keys })).outcome).toBe("passed");
  });

  it("is refused when the key names another issuer in its iss, whatever resolver supplied it", async () => {
    const keys = resolverFor({ [SET_URL]: { keys: [{ ...KEYS.es256.publicJwk, kid: "k" }] } });
    const check = await verifyIssuerKey(keyOf(KEYS.es256, { iss: PLATFORM_ISSUER }), ISSUER, { keys });
    expect(check.outcome).toBe("failed");
    expect(check.detail).toContain("iss member");
  });

  it("is not helped by a document of another address that names the issuer as controller", async () => {
    const keys = resolverFor({
      "https://evil.example/keys": {
        id: "https://evil.example/keys",
        verificationMethod: [
          { id: "https://evil.example/keys#k", controller: ISSUER, publicKeyJwk: KEYS.other.publicJwk },
        ],
        assertionMethod: ["https://evil.example/keys#k"],
      },
      [ISSUER]: controllerDocument(KEYS.es256, ["assertionMethod"]),
    });
    const key = await keys.resolve("https://evil.example/keys#k");
    expect(key).toMatchObject({ controller: ISSUER });
    expect((await verifyIssuerKey(key as VerificationKey, ISSUER, { keys })).outcome).toBe("failed");
  });
});

describe("what the check does when it cannot read what the issuer publishes", () => {
  it("is unavailable for a service that failed", async () => {
    const keys = createKeyResolver({ clock: clockAt(0), fetch: async () => new Response("", { status: 503 }) });
    const check = await verifyIssuerKey(keyOf(KEYS.es256), ISSUER, { keys });
    expect(check).toMatchObject({ check: "issuer", outcome: "unavailable" });
  });

  it("passes on the abort of the caller and the failure of a resolver that is no service", async () => {
    const aborting: KeyResolver = {
      resolve: async () => undefined,
      issuerKeys: async () => {
        throw new TypeError("broken");
      },
    };
    await expect(verifyIssuerKey(keyOf(KEYS.es256), ISSUER, { keys: aborting })).rejects.toThrow("broken");
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(
      verifyIssuerKey(keyOf(KEYS.es256), ISSUER, { keys: resolverFor({}), signal: controller.signal }),
    ).rejects.toThrow("stop");
  });

  it("is unavailable when the resolver rejects with a ServiceError of its own", async () => {
    const keys: KeyResolver = {
      resolve: async () => undefined,
      issuerKeys: async () => {
        throw new ServiceError("The document did not answer.", 0, "");
      },
    };
    expect((await verifyIssuerKey(keyOf(KEYS.es256), ISSUER, { keys })).outcome).toBe("unavailable");
  });

  it.each([
    ["a key that is null", JSON.parse("null"), ISSUER, { keys: resolverFor({}) }],
    ["an issuer that is a number", keyOf(KEYS.es256), JSON.parse("5"), { keys: resolverFor({}) }],
    ["options that are null", keyOf(KEYS.es256), ISSUER, JSON.parse("null")],
    ["keys that are a string", keyOf(KEYS.es256), ISSUER, JSON.parse('{"keys":"x"}')],
    ["a signal that is a string", keyOf(KEYS.es256), ISSUER, JSON.parse('{"signal":"x"}')],
  ])("refuses %s", async (_name, key, issuer, options) => {
    await expect(verifyIssuerKey(key, issuer, options)).rejects.toBeInstanceOf(DataError);
  });
});
