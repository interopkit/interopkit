// biome-ignore-all lint/style/useNamingConvention: the names of OAuth 2.0 requests and of LTI bodies are snake_case.

import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import { SCOPES } from "@interopkit/tool-integration";
import {
  type AssessmentControl,
  buildRegistrationInitiation,
  type GradebookStore,
  type RegistrationStore,
  type RosterStore,
} from "@interopkit/tool-integration/platform";
import {
  createServiceClient,
  discoverPlatform,
  readRegistrationInitiation,
  registerTool,
} from "@interopkit/tool-integration/tool";
import { compactVerify, jwtVerify } from "jose";
import { beforeAll, expect, test } from "vitest";
import { CLIENT_ID, CLOCK, createPair, DEPLOYMENT_ID, get, ISSUER, type Pair, platformFetch } from "./bench-setup.js";
import { expectRatioInTurns, PAGE_SIZE } from "./budgets.js";

const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
const CONTEXT_URL = `${ISSUER}/contexts/course-1`;
const LINE_ITEM_URL = `${CONTEXT_URL}/line-items/quiz-1`;

/** A roster that answers every request with the same page of members, so that the timing is the platform's. */
const roster: RosterStore = {
  members: async () => ({
    items: Array.from({ length: PAGE_SIZE }, (_, index) => ({
      userId: `user-${index}`,
      roles: [LEARNER],
      status: "Active",
      name: `Learner ${index}`,
      givenName: "Learner",
      familyName: `${index}`,
      email: `learner${index}@example.edu`,
      picture: `${ISSUER}/people/${index}.png`,
      lisPersonSourcedId: `sourced-${index}`,
    })),
    context: { label: "C1", title: "Course 1" },
  }),
};

/** A gradebook of one line item, whose results are a page and which keeps every score. */
const gradebook: GradebookStore = {
  lineItems: async () => ({ items: [] }),
  lineItem: async (_caller, _context, id) => ({ id, label: "Quiz", scoreMaximum: 10 }),
  createLineItem: async () => undefined,
  updateLineItem: async () => undefined,
  deleteLineItem: async () => false,
  results: async () => ({
    items: Array.from({ length: PAGE_SIZE }, (_, index) => ({
      userId: `user-${index}`,
      resultScore: index % 11,
      resultMaximum: 10,
      comment: "Good work",
    })),
  }),
  keepScore: async () => "kept",
};

/** Attempts that a proctoring tool may pause. */
const control: AssessmentControl = { control: async () => ({ status: "paused" }) };

/** Registrations that grant every tool the same client identifier. */
const registrations: RegistrationStore = {
  register: async (configuration) => ({ clientId: "tool-2", configuration }),
  get: async () => undefined,
  update: async () => undefined,
};

/** The requests that the tool sent to the platform while it used each service once, to be sent again. */
const sent: HttpRequest[] = [];
let pair: Pair;

beforeAll(async () => {
  pair = await createPair("RS256", { gradebook, roster, control, registrations });
  const fetch = platformFetch(pair, sent);
  const service = createServiceClient(
    { issuer: ISSUER, clientId: CLIENT_ID, deploymentId: DEPLOYMENT_ID },
    {
      registration: async () => pair.registration,
      clock: CLOCK,
      fetch,
      scopes: [SCOPES.score, SCOPES.resultReadonly, SCOPES.contextMembershipReadonly, SCOPES.assessmentControl],
    },
  );
  await service.publishScore(LINE_ITEM_URL, {
    userId: "ana",
    scoreGiven: 8,
    scoreMaximum: 10,
    comment: "Good work",
    timestamp: "2023-11-14T22:13:20.000Z",
    activityProgress: "Completed",
    gradingProgress: "FullyGraded",
  });
  expect((await service.results(LINE_ITEM_URL, { limit: PAGE_SIZE })).items).toHaveLength(PAGE_SIZE);
  expect((await service.members(`${CONTEXT_URL}/memberships`, { limit: PAGE_SIZE })).items).toHaveLength(PAGE_SIZE);
  await service.control(`${ISSUER}/assessment-control`, {
    user: { issuer: ISSUER, subject: "ana" },
    resourceLink: { id: "link-1" },
    attemptNumber: 1,
    action: "pause",
    incidentTime: "2023-11-14T22:13:20Z",
    incidentSeverity: 0.5,
  });
  const address = await buildRegistrationInitiation("https://tool.example.org/lti/register", {
    config: pair.requests.config,
    clock: CLOCK,
  });
  const initiation = readRegistrationInitiation(get(address));
  await registerTool(
    await discoverPlatform(initiation, { fetch }),
    {
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
    },
    initiation,
    { fetch },
  );
});

/** The request that the tool sent with a method to a URL whose path ends with `path`. */
function sentTo(method: string, path: string): HttpRequest {
  const request = sent.find((item) => item.method === method && new URL(item.url).pathname.endsWith(path));
  return request ?? expect.unreachable(`The tool sent no ${method} to ${path}.`);
}

/** The text of a body. */
const textOf = (body: HttpResponse["body"] | Uint8Array) =>
  typeof body === "string" ? body : new TextDecoder().decode(body);

/** The bearer token of a request. */
const tokenOf = (request: HttpRequest) => (request.headers.authorization ?? "").replace(/^Bearer /u, "");

/** Sends a request to the platform again, and checks the status of its answer. */
async function answered(request: HttpRequest, status: number): Promise<HttpResponse> {
  const answer = await pair.platform(request);
  expect(answer.status, textOf(answer.body)).toBe(status);
  return answer;
}

test("issues an access token within a multiple of jose's verification of the client assertion", async ({
  annotate,
  bench,
}) => {
  const request = sentTo("POST", "/token");
  await answered(request, 200);
  const assertion = new URLSearchParams(textOf(request.body)).get("client_assertion") ?? "";
  const verify = () =>
    jwtVerify(assertion, pair.toolKeys.publicKey, {
      issuer: CLIENT_ID,
      subject: CLIENT_ID,
      audience: `${ISSUER}/token`,
      currentDate: new Date(CLOCK.now()),
    });
  await verify();
  await expectRatioInTurns(
    { annotate, bench },
    "tokenEndpoint",
    { name: "jwtVerify of jose", fn: verify },
    { name: "the token endpoint", fn: () => pair.platform(request) },
  );
});

for (const [name, path] of [
  ["membersHandler", "/memberships"],
  ["resultsHandler", "/results"],
] as const) {
  test(`answers ${path} with a page of 1,000 within a multiple of JSON.stringify of the page`, async ({
    annotate,
    bench,
  }) => {
    const request = sentTo("GET", path);
    const page = JSON.parse(textOf((await answered(request, 200)).body));
    await expectRatioInTurns(
      { annotate, bench },
      name,
      { name: "JSON.stringify", fn: () => JSON.stringify(page) },
      { name: `the handler of ${path}`, fn: () => pair.platform(request) },
    );
  });
}

for (const [name, path, status] of [
  ["scoreHandler", "/scores", 204],
  ["controlHandler", "/assessment-control", 200],
] as const) {
  test(`answers a POST to ${path} within a multiple of jose's verification of its token and JSON.parse of its body`, async ({
    annotate,
    bench,
  }) => {
    const request = sentTo("POST", path);
    await answered(request, status);
    const token = tokenOf(request);
    const body = textOf(request.body);
    const key = pair.requests.config.hintKey;
    await expectRatioInTurns(
      { annotate, bench },
      name,
      {
        name: "compactVerify of jose and JSON.parse",
        fn: async () => {
          await compactVerify(token, key);
          return JSON.parse(body);
        },
      },
      { name: `the handler of ${path}`, fn: () => pair.platform(request) },
    );
  });
}

test("registers a tool within a multiple of jose's verification of its token and JSON.parse and JSON.stringify of the bodies", async ({
  annotate,
  bench,
}) => {
  const request = sentTo("POST", "/registration");
  const answer = JSON.parse(textOf((await answered(request, 201)).body));
  const token = tokenOf(request);
  const body = textOf(request.body);
  const key = pair.requests.config.hintKey;
  await expectRatioInTurns(
    { annotate, bench },
    "registrationHandler",
    {
      name: "compactVerify of jose, JSON.parse and JSON.stringify",
      fn: async () => {
        await compactVerify(token, key);
        JSON.parse(body);
        return JSON.stringify(answer);
      },
    },
    { name: "the handler of /registration", fn: () => pair.platform(request) },
  );
});
