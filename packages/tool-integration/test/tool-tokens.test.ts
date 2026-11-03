// biome-ignore-all lint/style/useNamingConvention: the names of LTI form parameters are snake_case.

import { readFileSync } from "node:fs";
import { createLocalJWKSet, type JSONWebKeySet } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createJwksCache } from "../src/index.js";
import { readMessage, signConsumerKey, verifyJwt, verifyMigration } from "../src/protocol/internal.js";
import { handleLaunch } from "../src/tool/index.js";
import { formPost, JWKS_URL, MemoryStore, registrationOf } from "./fake-platform.js";
import { createClock } from "./fixture.js";
import { toolKey } from "./tool-setup.js";

/** A launch that PyJWT signed with one algorithm, and the public key that verifies it. */
interface Signed {
  readonly algorithm: string;
  readonly jwk: JSONWebKeySet["keys"][number];
  readonly token: string;
}

/**
 * Tokens that `validation/lti_tokens.py` signs with PyJWT, and the reason that the tool must give for each it refuses: a
 * launch for each of the six algorithms of Security Framework 1.1 section 7.2, launches signed with algorithms outside the
 * list, and the signature of the LTI 1.1 consumer key of the worked example of the Migration Guide.
 */
interface Fixture {
  readonly issuer: string;
  readonly clientId: string;
  readonly deploymentId: string;
  readonly nonce: string;
  readonly now: number;
  readonly jwk: JSONWebKeySet["keys"][number];
  readonly cases: readonly { readonly name: string; readonly token: string; readonly reason: string | null }[];
  readonly algorithms: readonly Signed[];
  readonly outside: readonly Signed[];
  readonly migration: {
    readonly secret: string;
    readonly parts: Parameters<typeof signConsumerKey>[0];
    readonly signature: string;
  };
}

const fixture: Fixture = JSON.parse(readFileSync(new URL("./fixtures/lti-tokens.json", import.meta.url), "utf8"));
const NOW_MS = fixture.now * 1000;

describe("tokens signed by PyJWT", () => {
  const keys = createLocalJWKSet({ keys: [fixture.jwk] });
  const expected = { issuer: fixture.issuer, audience: fixture.clientId, requiredClaims: ["exp", "iat"] };

  it.each(fixture.cases)("verifies or refuses $name, as the fixture says", async ({ token, reason }) => {
    if (reason === null) {
      await expect(verifyJwt(token, keys, expected, NOW_MS)).resolves.toMatchObject({ iss: fixture.issuer });
    } else {
      await expect(verifyJwt(token, keys, expected, NOW_MS)).rejects.toMatchObject({ name: "LtiError", reason });
    }
  });

  it.each(fixture.algorithms)(
    "verifies a launch that PyJWT signed with $algorithm",
    async ({ algorithm, jwk, token }) => {
      const claims = await verifyJwt(token, createLocalJWKSet({ keys: [jwk] }), expected, NOW_MS);
      expect(claims.iss).toBe(fixture.issuer);
      expect(jwk.alg).toBe(algorithm);
    },
  );

  it.each(fixture.algorithms)(
    "refuses a launch that PyJWT signed with $algorithm when the registration names others",
    async ({ jwk, token }) => {
      await expect(
        verifyJwt(token, createLocalJWKSet({ keys: [jwk] }), { ...expected, algorithms: [] }, NOW_MS),
      ).rejects.toMatchObject({
        reason: "algorithm-unsupported",
      });
    },
  );

  it.each(fixture.algorithms)(
    "refuses a launch of $algorithm that another key of the key set could not have signed",
    async ({ algorithm, token }) => {
      const other = fixture.algorithms.find((signed) => signed.algorithm !== algorithm)?.jwk;
      await expect(
        verifyJwt(
          token,
          createLocalJWKSet({ keys: [{ ...other, kid: `platform-${algorithm.toLowerCase()}` } as never] }),
          expected,
          NOW_MS,
        ),
      ).rejects.toMatchObject({
        name: "LtiError",
      });
    },
  );

  it.each(fixture.outside)(
    "refuses a launch that PyJWT signed with $algorithm, before it asks for a key",
    async ({ jwk, token }) => {
      const keys = vi.fn(createLocalJWKSet({ keys: [jwk] }));
      await expect(verifyJwt(token, keys, expected, NOW_MS)).rejects.toMatchObject({ reason: "algorithm-unsupported" });
      expect(keys).not.toHaveBeenCalled();
    },
  );

  it("signs the consumer key of the Migration Guide's worked example with the signature that Python's hmac gives", async () => {
    const { parts, secret, signature } = fixture.migration;
    expect(parts.consumerKey).toBe("179248902");
    expect(await signConsumerKey(parts, secret)).toBe(signature);
    expect(signature).toBe("lWd54kFo5qU7xshAna6v8BwoBm6tmUjc6GTax6+12ps=");
  });

  it("verifies the signature of the consumer key in an lti1p1 claim against the secret, and no other", async () => {
    const { parts, secret, signature } = fixture.migration;
    const claims = {
      iss: parts.issuer,
      aud: parts.clientId,
      exp: parts.expiresAt,
      iat: parts.expiresAt - 60,
      nonce: parts.nonce,
      "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
      "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id": parts.deploymentId,
      "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "https://tool.example.com/launch",
      "https://purl.imsglobal.org/spec/lti/claim/roles": [],
      "https://purl.imsglobal.org/spec/lti/claim/resource_link": { id: "r1" },
      "https://purl.imsglobal.org/spec/lti/claim/lti1p1": {
        user_id: "34212",
        oauth_consumer_key: parts.consumerKey,
        oauth_consumer_key_sign: signature,
      },
    };
    const read = (change: Record<string, unknown> = {}) =>
      readMessage(
        { ...claims, ...change },
        { issuer: parts.issuer, clientId: parts.clientId, deploymentIds: [parts.deploymentId] },
      );
    const message = read();
    expect(message.migration?.verified).toBe(false);
    expect(await verifyMigration(message, secret)).toBe(true);
    expect(await verifyMigration(message, "another-secret")).toBe(false);
    const link = "https://purl.imsglobal.org/spec/lti/claim/lti1p1";
    const unsigned = read({ [link]: { oauth_consumer_key: parts.consumerKey } });
    expect(await verifyMigration(unsigned, secret)).toBe(false);
    for (const sign of [
      "",
      "lWd54kFo5qU7xshAna6v8BwoBm6tmUjc6GTax6+12ps",
      "lWd54kFo5qU7xshAna6v8BwoBm6tmUjc6GTax6+12pt=",
      "!!!!",
    ]) {
      const forged = read({ [link]: { oauth_consumer_key: parts.consumerKey, oauth_consumer_key_sign: sign } });
      expect(await verifyMigration(forged, secret), sign).toBe(false);
    }
    expect(await verifyMigration(read({ nonce: "other" }), secret)).toBe(false);
    expect(await verifyMigration(read({ nonce: 5 }), secret)).toBe(false);
    expect(
      await verifyMigration(
        read({ [link]: { oauth_consumer_key: "other", oauth_consumer_key_sign: signature } }),
        secret,
      ),
    ).toBe(false);
  });

  it("completes a launch with the token that PyJWT signed", async () => {
    const clock = createClock();
    expect(clock.now()).toBe(NOW_MS);
    const store = new MemoryStore();
    const state = "state-from-pyjwt";
    store.records.set(state, {
      nonce: fixture.nonce,
      issuer: fixture.issuer,
      clientId: fixture.clientId,
      deploymentId: fixture.deploymentId,
      targetLinkUri: "https://tool.example.com/lti/launch",
      expiresAt: NOW_MS + 600_000,
    });
    const registration = registrationOf(toolKey, {
      issuer: fixture.issuer,
      clientId: fixture.clientId,
      deploymentIds: [fixture.deploymentId],
    });
    const fetch = async (url: string) =>
      url === JWKS_URL ? Response.json({ keys: [fixture.jwk] }) : new Response("not found", { status: 404 });
    const options = {
      registration: async () => registration,
      clock,
      store,
      jwks: createJwksCache({ fetch, clock }),
    };
    const token = fixture.cases[0]?.token ?? "";
    const post = formPost({ id_token: token, state }, { cookie: `__Host-lti_state_${state}=${state}` });
    expect(await handleLaunch(post, options)).toMatchObject({
      messageType: "LtiResourceLinkRequest",
      deploymentId: fixture.deploymentId,
      user: { subject: "a6d5c443-1f51-4783-ba1a-7686ffe3b54a" },
      resourceLink: { id: "200d101f-2c14-434a-a0f3-57c2a42369fd" },
    });
    expect(store.records.size).toBe(0);
  });
});
