// biome-ignore-all lint/style/useNamingConvention: the names of the form fields of LTI are those of the specifications.

import type { HttpRequest } from "@interopkit/core/http";
import { type ContentItem, createJwksCache } from "@interopkit/tool-integration";
import {
  type MessageInput,
  readDeepLinkingResponse,
  readStartAssessment,
  type ToolMessageOptions,
} from "@interopkit/tool-integration/platform";
import {
  createDeepLinkResponse,
  createStartAssessmentPage,
  type LtiLaunchOptions,
  ltiLaunch,
} from "@interopkit/tool-integration/tool";
import { decodeJwt, jwtVerify, SignJWT } from "jose";
import { expect, test } from "vitest";
import {
  authenticate,
  CLIENT_ID,
  CLOCK,
  createPair,
  fullMessage,
  ISSUER,
  type Pair,
  platformFetch,
  postedFields,
} from "./bench-setup.js";
import { expectRatioInTurns } from "./budgets.js";

const FORM = { "content-type": "application/x-www-form-urlencoded" };
const RETURN_URL = `${ISSUER}/deep-links`;
const START_ASSESSMENT_URL = `${ISSUER}/start-assessment`;

/** The items of a Deep Linking response: a resource link with a line item, a link, a file, an HTML fragment and an image. */
const ITEMS: readonly ContentItem[] = [
  {
    type: "ltiResourceLink",
    title: "Tryout 1",
    url: "https://tool.example.org/lti/tryout-1",
    lineItem: { scoreMaximum: 100, label: "Tryout 1", resourceId: "tryout-1", tag: "exam" },
    custom: new Map([["exam", "tryout-1"]]),
  },
  { type: "link", url: "https://tool.example.org/syllabus", title: "Syllabus" },
  { type: "file", url: "https://tool.example.org/notes.pdf", title: "Notes", mediaType: "application/pdf" },
  { type: "html", html: "<p>Read the notes before the tryout.</p>", title: "Note" },
  { type: "image", url: "https://tool.example.org/chart.png", width: 640, height: 480 },
];

/** A Deep Linking request of a platform that takes every type, several at a time, with data of its own. */
function deepLinkingMessage(): MessageInput {
  const { custom: _custom, extensions: _extensions, services: _services, resourceLink: _link, ...base } = fullMessage();
  return {
    ...base,
    messageType: "LtiDeepLinkingRequest",
    settings: {
      returnUrl: RETURN_URL,
      acceptTypes: ["ltiResourceLink", "link", "file", "html", "image"],
      acceptPresentationDocumentTargets: ["iframe", "window", "embed"],
      acceptMediaTypes: ["application/pdf", "image/*"],
      acceptMultiple: true,
      acceptLineItem: true,
      data: { placement: "week-3" },
    },
  };
}

/** The Start Proctoring message of the first attempt of the learner at an exam. */
function startProctoringMessage(): MessageInput {
  const { custom: _custom, extensions: _extensions, services: _services, ...base } = fullMessage();
  return {
    ...base,
    messageType: "LtiStartProctoring",
    resourceLink: { id: "exam-1", title: "Final exam" },
    attemptNumber: 1,
    startAssessmentUrl: START_ASSESSMENT_URL,
  };
}

/** The launch of a message by the tool of a pair, with the options that the tool's other functions take. */
async function launchOf(pair: Pair, message: MessageInput) {
  const { cookie, idToken, state } = await authenticate(pair, message);
  const body = new TextEncoder().encode(new URLSearchParams({ id_token: idToken, state }).toString());
  const options: LtiLaunchOptions = {
    registration: async () => pair.registration,
    clock: CLOCK,
    store: pair.store,
    jwks: createJwksCache({ fetch: platformFetch(pair), clock: CLOCK }),
  };
  const launch = await ltiLaunch(
    { method: "POST", url: pair.registration.redirectUri, headers: { ...FORM, cookie }, body },
    options,
  );
  if (!("messageType" in launch)) throw new Error("The launch answered with a page.");
  return { launch, options };
}

/** The request that the page of the tool posts to the platform, and the JWT in it. */
function postOf(page: Awaited<ReturnType<typeof createDeepLinkResponse>>, url: string) {
  const jwt = postedFields(page).get("JWT") ?? "";
  const request: HttpRequest = {
    method: "POST",
    url,
    headers: FORM,
    body: new TextEncoder().encode(new URLSearchParams({ JWT: jwt }).toString()),
  };
  return { jwt, request };
}

/** What the platform needs to read a message of its tool, from the options of its handler. */
function readOptions(pair: Pair): ToolMessageOptions {
  const { config, clock, client, jwks, once } = pair.requests;
  return { config, clock, client, jwks, once };
}

/** Signs the claims of a JWT again with jose, under the header that the package wrote. */
function signAgain(pair: Pair, jwt: string) {
  const claims = decodeJwt(jwt);
  return () =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: pair.toolKeys.kid, typ: "JWT" })
      .sign(pair.toolKeys.privateKey);
}

/** Verifies a JWT of the tool with jose, as the platform must. */
function verifyAgain(pair: Pair, jwt: string) {
  return () =>
    jwtVerify(jwt, pair.toolKeys.publicKey, {
      issuer: CLIENT_ID,
      audience: ISSUER,
      currentDate: new Date(CLOCK.now()),
    });
}

test("answers a Deep Linking request with five items within a multiple of jose's signing of the same claims", async ({
  annotate,
  bench,
}) => {
  const pair = await createPair("RS256");
  const { launch, options } = await launchOf(pair, deepLinkingMessage());
  if (launch.messageType !== "LtiDeepLinkingRequest") throw new Error("The launch is not a Deep Linking request.");
  const answer = () => createDeepLinkResponse(launch, { items: ITEMS, message: "Placed." }, options);
  const { jwt, request } = postOf(await answer(), RETURN_URL);
  expect((await readDeepLinkingResponse(request, readOptions(pair))).items).toHaveLength(ITEMS.length);
  await expectRatioInTurns(
    { annotate, bench },
    "deepLinkingResponse",
    { name: "SignJWT of jose", fn: signAgain(pair, jwt) },
    { name: "createDeepLinkResponse", fn: answer },
  );
});

test("reads a Deep Linking response with five items within a multiple of jose's verification of its JWT", async ({
  annotate,
  bench,
}) => {
  const pair = await createPair("RS256");
  const { launch, options } = await launchOf(pair, deepLinkingMessage());
  if (launch.messageType !== "LtiDeepLinkingRequest") throw new Error("The launch is not a Deep Linking request.");
  const { jwt, request } = postOf(await createDeepLinkResponse(launch, { items: ITEMS }, options), RETURN_URL);
  await verifyAgain(pair, jwt)();
  await expectRatioInTurns(
    { annotate, bench },
    "readDeepLinkingResponse",
    { name: "jwtVerify of jose", fn: verifyAgain(pair, jwt) },
    { name: "readDeepLinkingResponse", fn: () => readDeepLinkingResponse(request, readOptions(pair)) },
  );
});

test("sends a Start Assessment message within a multiple of jose's signing of the same claims", async ({
  annotate,
  bench,
}) => {
  const pair = await createPair("RS256");
  const { launch, options } = await launchOf(pair, startProctoringMessage());
  if (launch.messageType !== "LtiStartProctoring") throw new Error("The launch is not a Start Proctoring message.");
  const page = () => createStartAssessmentPage(launch, { endAssessmentReturn: true }, options);
  const { jwt, request } = postOf(await page(), START_ASSESSMENT_URL);
  expect(await readStartAssessment(request, readOptions(pair))).toMatchObject({ attemptNumber: 1 });
  await expectRatioInTurns(
    { annotate, bench },
    "startAssessment",
    { name: "SignJWT of jose", fn: signAgain(pair, jwt) },
    { name: "createStartAssessmentPage", fn: page },
  );
});

test("reads a Start Assessment message within a multiple of jose's verification of its JWT", async ({
  annotate,
  bench,
}) => {
  const pair = await createPair("RS256");
  const { launch, options } = await launchOf(pair, startProctoringMessage());
  if (launch.messageType !== "LtiStartProctoring") throw new Error("The launch is not a Start Proctoring message.");
  const { jwt, request } = postOf(await createStartAssessmentPage(launch, {}, options), START_ASSESSMENT_URL);
  await verifyAgain(pair, jwt)();
  await expectRatioInTurns(
    { annotate, bench },
    "readStartAssessment",
    { name: "jwtVerify of jose", fn: verifyAgain(pair, jwt) },
    { name: "readStartAssessment", fn: () => readStartAssessment(request, readOptions(pair)) },
  );
});
