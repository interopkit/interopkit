// biome-ignore-all lint/style/useNamingConvention: the names of LTI form parameters are snake_case.

import { readFileSync } from "node:fs";
import { createLocalJWKSet, type JSONWebKeySet } from "jose";
import { describe, expect, it } from "vitest";
import { createJwksCache } from "../src/index.js";
import { verifyJwt } from "../src/protocol/internal.js";
import { ltiLaunch } from "../src/tool/index.js";
import { formPost, JWKS_URL, MemoryStore, registrationOf } from "./fake-platform.js";
import { createClock } from "./fixture.js";
import { toolKey } from "./tool-setup.js";

/** Tokens that `validation/lti_tokens.py` signs with PyJWT, and the reason that the tool must give for each it refuses. */
interface Fixture {
  readonly issuer: string;
  readonly clientId: string;
  readonly deploymentId: string;
  readonly nonce: string;
  readonly now: number;
  readonly jwk: JSONWebKeySet["keys"][number];
  readonly cases: readonly { readonly name: string; readonly token: string; readonly reason: string | null }[];
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

  it("completes a launch with the token that PyJWT signed", async () => {
    const clock = createClock();
    expect(clock.now()).toBe(NOW_MS);
    const store = new MemoryStore();
    const state = "state-from-pyjwt";
    store.records.set(state, {
      nonce: fixture.nonce,
      issuer: fixture.issuer,
      clientId: fixture.clientId,
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
      jwks: createJwksCache({ fetch }),
    };
    const token = fixture.cases[0]?.token ?? "";
    const post = formPost({ id_token: token, state }, { cookie: `__Host-lti_state_${state}=${state}` });
    expect(await ltiLaunch(post, options)).toMatchObject({
      messageType: "LtiResourceLinkRequest",
      deploymentId: fixture.deploymentId,
      subject: "a6d5c443-1f51-4783-ba1a-7686ffe3b54a",
      resourceLink: { id: "200d101f-2c14-434a-a0f3-57c2a42369fd" },
    });
    expect(store.records.size).toBe(0);
  });
});
