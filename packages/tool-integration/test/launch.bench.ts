// biome-ignore-all lint/style/useNamingConvention: the names of the form fields of a launch are those of LTI, in snake_case.

import type { HttpRequest } from "@interopkit/core/http";
import { createJwksCache } from "@interopkit/tool-integration";
import { ltiLaunch } from "@interopkit/tool-integration/tool";
import { decodeJwt, jwtVerify, SignJWT } from "jose";
import { expect, test } from "vitest";
import {
  type Algorithm,
  authenticate,
  CLIENT_ID,
  CLOCK,
  createPair,
  fullMessage,
  get,
  ISSUER,
  type Pair,
  platformFetch,
  postedFields,
} from "./bench-setup.js";
import { expectRatioInTurns, type RATIOS } from "./budgets.js";

const ALGORITHMS: readonly Algorithm[] = ["RS256", "ES256"];
const FORM = { "content-type": "application/x-www-form-urlencoded" };

/** The names of the budgets of each algorithm. */
const LAUNCH: Record<Algorithm, keyof typeof RATIOS> = { RS256: "launchRs256", ES256: "launchEs256" };
const AUTHORIZE: Record<Algorithm, keyof typeof RATIOS> = { RS256: "authorizeRs256", ES256: "authorizeEs256" };

/** The launch request of one login, which the tool validates every time because its store keeps the login. */
async function launchRequest(pair: Pair) {
  const { cookie, idToken, state } = await authenticate(pair, fullMessage());
  const body = new TextEncoder().encode(new URLSearchParams({ id_token: idToken, state }).toString());
  return {
    idToken,
    request: { method: "POST", url: pair.registration.redirectUri, headers: { ...FORM, cookie }, body },
  };
}

/** The authorization request that the tool sends the browser to, for a message, which the platform answers every time. */
async function authorizeRequest(pair: Pair, custom?: Readonly<Record<string, string>>) {
  const { authentication } = await authenticate(pair, fullMessage(custom));
  return get(authentication);
}

for (const algorithm of ALGORITHMS) {
  test(`validates a launch signed with ${algorithm} within a multiple of jose's verification of its token`, async ({
    annotate,
    bench,
  }) => {
    const pair = await createPair(algorithm);
    const { idToken, request } = await launchRequest(pair);
    const options = {
      registration: async () => pair.registration,
      clock: CLOCK,
      store: pair.store,
      jwks: createJwksCache({ fetch: platformFetch(pair), clock: CLOCK }),
    };
    expect("messageType" in (await ltiLaunch(request, options))).toBe(true);
    const verify = () =>
      jwtVerify(idToken, pair.keys.publicKey, {
        issuer: ISSUER,
        audience: CLIENT_ID,
        currentDate: new Date(CLOCK.now()),
      });
    expect((await verify()).payload.sub).toBe("ana");

    await expectRatioInTurns(
      { annotate, bench },
      LAUNCH[algorithm],
      { name: "jwtVerify of jose", fn: verify },
      { name: "ltiLaunch", fn: () => ltiLaunch(request, options) },
    );
  });
}

for (const algorithm of ALGORITHMS) {
  test(`issues an id_token signed with ${algorithm} with every claim within a multiple of jose's signing of the same claims`, async ({
    annotate,
    bench,
  }) => {
    const pair = await createPair(algorithm);
    const request = await authorizeRequest(pair);
    const page = await pair.platform(request);
    expect(page.status).toBe(200);
    const claims = decodeJwt(postedFields(page).get("id_token") ?? "");
    expect(Object.keys(claims).length).toBeGreaterThan(20);

    const sign = () =>
      new SignJWT(claims).setProtectedHeader({ alg: algorithm, kid: pair.keys.kid }).sign(pair.keys.privateKey);
    await expectRatioInTurns(
      { annotate, bench },
      AUTHORIZE[algorithm],
      { name: "SignJWT of jose", fn: sign },
      { name: "the authorization request", fn: () => pair.platform(request) },
    );
  });
}

test("substitutes every variable that the platform supports within a multiple of the same request with plain values", async ({
  annotate,
  bench,
}) => {
  const registrations = {
    registrations: {
      register: async () => {
        throw new Error("The benchmark registers no tool.");
      },
      get: async () => undefined,
      update: async () => undefined,
    },
  };
  const pair = await createPair("RS256", registrations);
  const configuration = await pair.platform(get(`${ISSUER}/.well-known/openid-configuration`));
  const text =
    typeof configuration.body === "string" ? configuration.body : new TextDecoder().decode(configuration.body);
  const variables: string[] = JSON.parse(text)["https://purl.imsglobal.org/spec/lti-platform-configuration"].variables;
  expect(variables.length).toBeGreaterThan(40);
  const names = variables.map((_, index) => `v${index}`);
  const substituting = await authorizeRequest(
    pair,
    Object.fromEntries(variables.map((variable, index) => [names[index] ?? "", `$${variable}`])),
  );
  const plain = await authorizeRequest(
    pair,
    Object.fromEntries(variables.map((variable, index) => [names[index] ?? "", variable])),
  );
  const claimsOf = async (request: HttpRequest) =>
    decodeJwt(postedFields(await pair.platform(request)).get("id_token") ?? "");
  const custom = (claims: Awaited<ReturnType<typeof claimsOf>>) =>
    claims["https://purl.imsglobal.org/spec/lti/claim/custom"] as Record<string, string>;
  // The substituted values are the message's, and the plain ones are the names as written.
  expect(custom(await claimsOf(substituting)).v0).not.toBe(variables[0]);
  expect(custom(await claimsOf(plain)).v0).toBe(variables[0]);
  await annotate(`The request substitutes ${variables.length} variables.`);

  await expectRatioInTurns(
    { annotate, bench },
    "substitution",
    { name: "the same request with plain values", fn: () => pair.platform(plain) },
    { name: "the authorization request with every variable", fn: () => pair.platform(substituting) },
  );
});
