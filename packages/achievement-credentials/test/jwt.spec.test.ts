import { resolve } from "node:path";
import { signCompactJws } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import { readCredential } from "../src/index.js";
import { readCredentialJwt } from "../src/jwt/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { clockAt, KEYS, serve, signerOf } from "./key-fixtures.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const ISSUER = "https://example.edu/issuers/565049";

type Block = Record<string, unknown>;
const blocks = readSpecPage(ROOT, "open-badges-3p0.json").filter(
  (block): block is Block => typeof block === "object" && block !== null && !Array.isArray(block),
);

/** The JWS of section 5 of Open Badges: the header and the credential that the page prints, signed with a key of the test. */
const header = blocks.find((block) => block.alg === "RS256" && typeof block.kid === "string");
const credential = blocks.find((block) => block.id === "http://example.edu/credentials/3732");
const profile = blocks.find((block) => block.id === ISSUER);

describe("the JWT example of Open Badges 3.0", () => {
  const clock = clockAt(Date.UTC(2024, 5, 14));
  const fetch = serve({
    "https://example.edu/keys": { keys: [{ ...KEYS.rs256.publicJwk, kid: "key-1" }] },
    [ISSUER]: profile,
  }).fetch;
  const options = { keys: createKeyResolver({ clock, fetch }), clock };

  it("holds the header, the credential and the profile that the tests sign and read", () => {
    expect(header).toStrictEqual({ alg: "RS256", kid: "https://example.edu/keys#key-1", typ: "JWT" });
    expect(credential).toBeDefined();
    expect(profile).toBeDefined();
  });

  it("has a valid signature and a key that its issuer does not publish: the page gives no key for the issuer", async () => {
    const jws = await signCompactJws(
      header ?? {},
      new TextEncoder().encode(JSON.stringify(credential)),
      signerOf(KEYS.rs256),
    );
    expect(await readCredentialJwt(jws, { ...options, allowUnboundKeys: true })).toMatchObject({
      valid: true,
      bound: false,
      key: { id: "https://example.edu/keys#key-1" },
      credential: readCredential(credential),
    });
    expect(await readCredentialJwt(jws, options)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("does not publish"),
    });
  });
});
