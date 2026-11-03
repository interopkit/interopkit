// biome-ignore-all lint/style/useNamingConvention: the names of OAuth 2.0 answers and of LTI bodies are snake_case.

import { callService } from "@interopkit/core";
import { SCOPES } from "@interopkit/tool-integration";
import { createServiceClient, discoverPlatform, registerTool } from "@interopkit/tool-integration/tool";
import { expect, test } from "vitest";
import { CLIENT_ID, CLOCK, createPair, DEPLOYMENT_ID, ISSUER, platformFetch } from "./bench-setup.js";
import { expectRatioInTurns } from "./budgets.js";

const LINE_ITEM_URL = `${ISSUER}/contexts/course-1/line-items/quiz-1`;
const CONTROL_URL = `${ISSUER}/assessment-control`;
const REGISTRATION_URL = `${ISSUER}/registration`;
const TOKEN = "token-1";
const TIMEOUT_MS = 10_000;

/** A score with every member that a tool commonly sends. */
const SCORE = {
  userId: "ana",
  scoreGiven: 8,
  scoreMaximum: 10,
  comment: "Good work",
  timestamp: "2023-11-14T22:13:20.000Z",
  activityProgress: "Completed",
  gradingProgress: "FullyGraded",
} as const;

/** A request to pause an attempt, with the incident that caused it. */
const CONTROL = {
  user: { issuer: ISSUER, subject: "ana" },
  resourceLink: { id: "link-1" },
  attemptNumber: 1,
  action: "pause",
  incidentTime: "2023-11-14T22:13:20Z",
  incidentSeverity: 0.5,
  reasonCode: "face-absent",
  reasonMessage: "The candidate left the camera.",
} as const;

/** The answer of the Assessment Control Service to it. */
const CONTROL_STATUS = JSON.stringify({ status: "paused" });

/** The platform's answer to a registration: the tool's configuration with its client identifier. */
const REGISTERED = JSON.stringify({
  client_id: "tool-2",
  application_type: "web",
  response_types: ["id_token"],
  grant_types: ["implicit", "client_credentials"],
  initiate_login_uri: "https://tool.example.org/lti/login",
  redirect_uris: ["https://tool.example.org/lti/launch"],
  client_name: "Tryout",
  jwks_uri: "https://tool.example.org/jwks",
  token_endpoint_auth_method: "private_key_jwt",
  scope: SCOPES.score,
  "https://purl.imsglobal.org/spec/lti-tool-configuration": {
    domain: "tool.example.org",
    target_link_uri: "https://tool.example.org/lti/launch",
    claims: ["iss", "sub"],
    messages: [{ type: "LtiResourceLinkRequest" }],
    deployment_id: "deployment-2",
  },
});

/** The answers of a platform to the calls of a tool: a token, and each service at once. */
function answer(url: string): Response {
  if (url === `${ISSUER}/token`) {
    return Response.json({
      access_token: TOKEN,
      token_type: "Bearer",
      expires_in: 3600,
      scope: `${SCOPES.score} ${SCOPES.assessmentControl}`,
    });
  }
  if (url === CONTROL_URL) {
    return new Response(CONTROL_STATUS, {
      headers: { "content-type": "application/vnd.ims.lti-ap.v1.control+json" },
    });
  }
  if (url === REGISTRATION_URL) return new Response(REGISTERED, { headers: { "content-type": "application/json" } });
  return new Response(null, { status: 204 });
}

const fetch = async (url: string) => answer(url);

/** The client of a tool whose platform answers at once, with a token in its cache. */
async function client() {
  const pair = await createPair("RS256");
  return createServiceClient(
    { issuer: ISSUER, clientId: CLIENT_ID, deploymentId: DEPLOYMENT_ID },
    {
      registration: async () => pair.registration,
      clock: CLOCK,
      fetch,
      scopes: [SCOPES.score, SCOPES.assessmentControl],
    },
  );
}

/** The bare call that a client builds on: the same request, through `callService` of core, without the work of the client. */
function bareCall(url: string, type: string, body: string) {
  return () =>
    callService({ fetch, timeoutMs: TIMEOUT_MS }, "The service", url, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": type, accept: "application/json" },
      body,
    });
}

test("publishes a score within a multiple of the bare call of the same request", async ({ annotate, bench }) => {
  const service = await client();
  await service.publishScore(LINE_ITEM_URL, SCORE);
  await expectRatioInTurns(
    { annotate, bench },
    "publishScore",
    {
      name: "callService of the same request",
      fn: bareCall(`${LINE_ITEM_URL}/scores`, "application/vnd.ims.lis.v1.score+json", JSON.stringify(SCORE)),
    },
    { name: "publishScore", fn: () => service.publishScore(LINE_ITEM_URL, SCORE) },
  );
});

test("sends a control request of proctoring within a multiple of the bare call of the same request", async ({
  annotate,
  bench,
}) => {
  const service = await client();
  expect(await service.control(CONTROL_URL, CONTROL)).toMatchObject({ status: "paused" });
  await expectRatioInTurns(
    { annotate, bench },
    "control",
    {
      name: "callService of the same request",
      fn: bareCall(CONTROL_URL, "application/vnd.ims.lti-ap.v1.control+json", JSON.stringify(CONTROL)),
    },
    { name: "control", fn: () => service.control(CONTROL_URL, CONTROL) },
  );
});

test("registers a tool within a multiple of the bare call of the same request", async ({ annotate, bench }) => {
  const pair = await createPair("RS256", {
    registrations: {
      register: async () => ({
        reason: "invalid_client_metadata" as const,
        message: "The benchmark registers no tool with the platform.",
      }),
      get: async () => undefined,
      update: async () => undefined,
    },
  });
  const initiation = {
    openidConfiguration: `${ISSUER}/.well-known/openid-configuration`,
    registrationToken: "token-2",
  };
  const platform = await discoverPlatform(initiation, { fetch: platformFetch(pair) });
  expect(platform.registrationEndpoint).toBe(REGISTRATION_URL);
  const tool = {
    initiateLoginUri: "https://tool.example.org/lti/login",
    redirectUris: ["https://tool.example.org/lti/launch"],
    clientName: "Tryout",
    jwksUri: "https://tool.example.org/jwks",
    scope: SCOPES.score,
    lti: {
      domain: "tool.example.org",
      targetLinkUri: "https://tool.example.org/lti/launch",
      messages: [{ type: "LtiResourceLinkRequest" }],
      claims: ["iss", "sub"],
    },
  };
  const register = () => registerTool(platform, tool, initiation, { fetch });
  expect(await register()).toMatchObject({ clientId: "tool-2" });
  await expectRatioInTurns(
    { annotate, bench },
    "registerTool",
    { name: "callService of the same request", fn: bareCall(REGISTRATION_URL, "application/json", REGISTERED) },
    { name: "registerTool", fn: register },
  );
});
