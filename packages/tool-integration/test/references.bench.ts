// biome-ignore-all lint/style/useNamingConvention: the names of the parameters of an LTI login are snake_case.

import type { HttpRequest } from "@interopkit/core/http";
import { createJwksCache } from "@interopkit/tool-integration";
import { ltiLaunch } from "@interopkit/tool-integration/tool";
import { LTITool } from "@lti-tool/core";
import { createLtiTool, type OneTimeStore } from "lti-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  authenticate,
  CLIENT_ID,
  CLOCK,
  createPair,
  DEPLOYMENT_ID,
  fullMessage,
  get,
  ISSUER,
  type Pair,
  platformFetch,
  postedFields,
} from "./bench-setup.js";
import { expectRatioInTurns } from "./budgets.js";
import { createMemoryStorage } from "./references-storage.js";

const FORM = { "content-type": "application/x-www-form-urlencoded" };
const REDIRECT_URI = "https://tool.example.org/lti/launch";

let pair: Pair;

// The tools of other authors read the time of the system and fetch the key set with the global fetch: the run sets both to
// those of the platform, whose tokens carry the fixed time of the benchmarks.
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(CLOCK.now());
  pair = await createPair("RS256");
  const fetch = platformFetch(pair);
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) =>
    fetch(String(input), {
      method: "GET",
      headers: { accept: new Headers(init?.headers).get("accept") ?? "*/*" },
      redirect: "manual",
      signal: init?.signal ?? new AbortController().signal,
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The launch of the message that every tool validates, as the package's tool takes it. */
async function ownLaunch() {
  const { cookie, idToken, state } = await authenticate(pair, fullMessage());
  const body = new TextEncoder().encode(new URLSearchParams({ id_token: idToken, state }).toString());
  const request: HttpRequest = {
    method: "POST",
    url: pair.registration.redirectUri,
    headers: { ...FORM, cookie },
    body,
  };
  const options = {
    registration: async () => pair.registration,
    clock: CLOCK,
    store: pair.store,
    jwks: createJwksCache({ fetch: platformFetch(pair), clock: CLOCK }),
  };
  expect(await ltiLaunch(request, options)).toMatchObject({ messageType: "LtiResourceLinkRequest" });
  return () => ltiLaunch(request, options);
}

/** The parameters of the platform's login of the message, as a tool's login route receives them. */
async function loginParameters(): Promise<Record<string, string>> {
  return Object.fromEntries(new URL(await pair.login(fullMessage())).searchParams);
}

/** The platform's answer to the authentication request of a tool: the `id_token` and the `state` that it posts. */
async function answerOf(authentication: string) {
  const fields = postedFields(await pair.platform(get(authentication)));
  return { idToken: fields.get("id_token") ?? "", state: fields.get("state") ?? "" };
}

test("validates a launch within a multiple of @lti-tool/core's validation of the same message", async ({
  annotate,
  bench,
}) => {
  const storage = createMemoryStorage();
  const keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  // The nonce of the login stays valid, so that one login serves every validation of the run, as the store of the package's tool does.
  const tool = new LTITool({
    stateSecret: crypto.getRandomValues(new Uint8Array(32)),
    keyPair: keys,
    storage: { ...storage, validateNonce: async (nonce) => storage.nonces.has(nonce) },
  });
  const client = await tool.addClient({
    name: "Platform",
    iss: ISSUER,
    clientId: CLIENT_ID,
    authUrl: `${ISSUER}/authorize`,
    tokenUrl: `${ISSUER}/token`,
    jwksUrl: `${ISSUER}/jwks`,
  });
  await tool.addDeployment(client, { deploymentId: DEPLOYMENT_ID });
  const login = await loginParameters();
  const authentication = await tool.handleLogin({
    client_id: login.client_id ?? "",
    iss: login.iss ?? "",
    launchUrl: REDIRECT_URI,
    login_hint: login.login_hint ?? "",
    target_link_uri: login.target_link_uri ?? "",
    lti_deployment_id: login.lti_deployment_id ?? "",
    lti_message_hint: login.lti_message_hint,
  });
  const { idToken, state } = await answerOf(authentication);
  expect(await tool.verifyLaunch(idToken, state)).toMatchObject({ sub: "ana" });
  await expectRatioInTurns(
    { annotate, bench },
    "launchAgainstLtiTool",
    { name: "verifyLaunch of @lti-tool/core", fn: () => tool.verifyLaunch(idToken, state) },
    { name: "ltiLaunch", fn: await ownLaunch() },
  );
});

test("validates a launch within a multiple of lti-core's validation of the same message", async ({
  annotate,
  bench,
}) => {
  // The state and the nonce of the login stay in the store, so that one login serves every validation of the run.
  const kept = new Map<string, string>();
  const store: OneTimeStore = {
    put: async (key, value) => void kept.set(key, value),
    take: async (key) => kept.get(key),
  };
  const tool = createLtiTool({
    resolver: {
      resolve: async (issuer) =>
        issuer === ISSUER
          ? [
              {
                issuer,
                clientId: CLIENT_ID,
                authorizationEndpoint: `${ISSUER}/authorize`,
                jwksUri: `${ISSUER}/jwks`,
                deployments: [DEPLOYMENT_ID],
                allowedTargetLinkUris: [REDIRECT_URI],
              },
            ]
          : [],
    },
    redirectUri: REDIRECT_URI,
    store,
  });
  const { url } = await tool.initiate(await loginParameters());
  const { idToken, state } = await answerOf(url);
  expect(await tool.validate({ state, id_token: idToken })).toMatchObject({ messageType: "LtiResourceLinkRequest" });
  await expectRatioInTurns(
    { annotate, bench },
    "launchAgainstLtiCore",
    { name: "validate of lti-core", fn: () => tool.validate({ state, id_token: idToken }) },
    { name: "ltiLaunch", fn: await ownLaunch() },
  );
});
