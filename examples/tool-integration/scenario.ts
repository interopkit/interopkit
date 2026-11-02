// biome-ignore-all lint/style/useNamingConvention: the names of the form fields are those of LTI, in snake_case.

import type { Clock } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import type { MessageInput, PlatformFrame } from "@interopkit/tool-integration/platform";
import { generateSigningKeys } from "./src/keys.ts";
import { connect, type Handler, plainRequest, textOf } from "./src/network.ts";
import { createPlatform, type Platform } from "./src/platform.ts";
import { DEEP_LINKING_PATH, setupPlatform } from "./src/platform-setup.ts";
import { createTool } from "./src/tool.ts";
import { setupTool } from "./src/tool-setup.ts";

const TOOL_ORIGIN = "https://tool.example";
const CLIENT_ID = "962fa4d8-bcbf-49a0-94b2-2de05ad274af";
const DEPLOYMENT_ID = "07940580-b309-415e-a37c-914d387c1150";
const KEY_ID = "tool-1";
const NOW = 1_700_000_000_000;
const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
const INSTRUCTOR = "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor";

/** What the scenario shows: the launch the tool accepted, the grading, the content the tool placed, and the replay the platform refused. */
export interface Outcome {
  readonly login: { readonly toolHost: string; readonly storageUrl: string };
  readonly launch: Readonly<Record<string, unknown>>;
  readonly graded: Readonly<Record<string, unknown>>;
  readonly kept: readonly Readonly<Record<string, unknown>>[];
  readonly deepLinked: Readonly<Record<string, unknown>>;
  readonly replay: { readonly status: number; readonly error: string };
}

/** Decodes the five entities that the pages of the packages write into an attribute. */
function decodeAttribute(text: string): string {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** Reads the configuration that a page of the client-side login carries for its script. */
function configOf(page: string): Record<string, string> {
  return JSON.parse(decodeAttribute(/data-config="([^"]*)"/u.exec(page)?.[1] ?? "{}"));
}

/** Reads the form that a page posts: its action and its hidden fields, decoded. */
function postOf(page: string): { readonly action: string; readonly fields: ReadonlyMap<string, string> } {
  const fields = new Map<string, string>();
  for (const [, name = "", value = ""] of page.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)">/gu)) {
    fields.set(decodeAttribute(name), decodeAttribute(value));
  }
  return { action: decodeAttribute(/<form id="form" method="post" action="([^"]*)"/u.exec(page)?.[1] ?? ""), fields };
}

const FORM_TYPE = { "content-type": "application/x-www-form-urlencoded" };

/** What the browser did for a message: the frame of the tool, the authentication request, and the tool's answer to the launch. */
interface Visit {
  readonly frame: PlatformFrame;
  readonly authenticationRequest: string;
  readonly launched: HttpResponse;
}

/**
 * Plays the browser for a message that the platform keeps: it opens the frame of the tool, which answers the platform's
 * request for client-side login with a page that keeps its `state` and `nonce` in the platform's storage and then sends the
 * browser to the platform to authenticate; the platform answers with the page that posts the `id_token`; the tool's page
 * fetches the stored values, and the browser posts them with the token to the tool's launch URL.
 */
async function browse(platform: Platform, tool: Handler, message: MessageInput): Promise<Visit> {
  const frame = await platform.frame(message);
  const login = await tool(plainRequest("GET", frame.url));
  const stored = configOf(textOf(login));
  const storage = new Map([
    [`state_${stored.state}`, stored.state ?? ""],
    [`nonce_${stored.nonce}`, stored.nonce ?? ""],
  ]);
  const authenticationRequest = stored.authenticationRequest ?? "";
  const authentication = await platform.handle(plainRequest("GET", authenticationRequest));
  const { action, fields: posted } = postOf(textOf(authentication));
  const fields = { id_token: posted.get("id_token") ?? "", state: posted.get("state") ?? "" };
  // The platform's post is answered with a page that fetches the stored values; the browser posts them back from the tool's origin.
  const verification = await tool(
    plainRequest("POST", action, { ...FORM_TYPE, origin: platform.origin }, new URLSearchParams(fields).toString()),
  );
  const fetched = configOf(textOf(verification));
  const verified = new URLSearchParams({
    ...fields,
    stored_state: storage.get(`state_${fetched.state}`) ?? "",
    stored_nonce: storage.get(`nonce_${fetched.nonce}`) ?? "",
  });
  const launched = await tool(plainRequest("POST", action, { ...FORM_TYPE, origin: TOOL_ORIGIN }, verified.toString()));
  return { frame, authenticationRequest, launched };
}

/**
 * Launches a tool from a platform, takes its score and lets it place content, each side with the role of this package, over
 * an in-memory network. The steps are those of the browser: the platform keeps the message and prepares the login URL, the
 * browser asks the tool, then the platform to authenticate, then posts the `id_token` to the tool. The tool then reads its line
 * item, posts the score and reads the results back through the grade services. A Deep Linking request goes the same way, and
 * the tool answers it with a page that posts the signed response to the platform, which reads it.
 *
 * @returns What each side saw.
 */
export async function runScenario(): Promise<Outcome> {
  const clock: Clock = { now: () => NOW };
  const toolKeys = await generateSigningKeys();
  const platform = createPlatform(
    await setupPlatform(clock, {
      clientId: CLIENT_ID,
      deploymentId: DEPLOYMENT_ID,
      loginUrl: `${TOOL_ORIGIN}/lti/login`,
      redirectUri: `${TOOL_ORIGIN}/lti/launch`,
      keyId: KEY_ID,
      publicKey: toolKeys.publicKey,
    }),
  );
  // The two systems reach each other through one network; the tool's calls to the platform are made through it.
  const systems: Parameters<typeof connect>[0] = { [platform.origin]: platform.handle };
  const network = connect(systems);
  const tool = createTool(
    setupTool(
      clock,
      network,
      TOOL_ORIGIN,
      {
        issuer: platform.issuer,
        clientId: CLIENT_ID,
        deploymentId: DEPLOYMENT_ID,
        authenticationUrl: platform.endpoints.authorization,
        jwksUrl: platform.endpoints.jwks,
        accessTokenUrl: platform.endpoints.token,
      },
      { keyId: KEY_ID, signingKey: toolKeys.privateKey },
    ),
  );
  Object.assign(systems, { [TOOL_ORIGIN]: tool.handle });

  // The platform's gradebook has a line item for the quiz in the course, and the launch offers it to the tool.
  platform.gradebook.add(CLIENT_ID, "course-1", { id: "quiz-1", label: "Drawing quiz", scoreMaximum: 10 });
  const base = {
    clientId: CLIENT_ID,
    deploymentId: DEPLOYMENT_ID,
    targetLinkUri: `${TOOL_ORIGIN}/lti/launch`,
    context: { id: "course-1", title: "Tryout" },
  };
  const { frame, authenticationRequest, launched } = await browse(platform, tool.handle, {
    ...base,
    messageType: "LtiResourceLinkRequest",
    user: { subject: "candidate-7" },
    roles: [LEARNER],
    resourceLink: { id: "session-1-question-4", title: "Drawing tool" },
    custom: { exam: "tryout-1", user: "$User.id", lineItem: "$LineItem.url" },
    services: { grades: { lineItemId: "quiz-1", container: false } },
  });
  const launch = tool.launches[0];
  if (launch === undefined) throw new Error(`The tool did not accept the launch: ${launched.status}.`);

  // The tool grades the user of the launch through the grade services.
  const graded = await tool.grade(launch, 8);

  // The authentication request of a launch is answered once: the message is taken, so the same request a second time gets
  // the authentication error response, which the page posts to the tool.
  const again = await platform.handle(plainRequest("GET", authenticationRequest));
  const replay = { status: again.status, error: postOf(textOf(again)).fields.get("error") ?? "" };

  // An instructor adds content to the course: the platform asks the tool for it, with data of its own that comes back sealed,
  // the tool answers with a page that posts its response to the platform's return URL, and the platform reads the response.
  const returnUrl = `${platform.origin}${DEEP_LINKING_PATH}`;
  const picking = await browse(platform, tool.handle, {
    ...base,
    messageType: "LtiDeepLinkingRequest",
    user: { subject: "instructor-1" },
    roles: [INSTRUCTOR],
    settings: {
      returnUrl,
      acceptTypes: ["ltiResourceLink"],
      acceptPresentationDocumentTargets: ["iframe"],
      acceptLineItem: true,
      data: { placement: "week-3" },
    },
  });
  const answer = postOf(textOf(picking.launched));
  const received = await platform.handle(
    plainRequest("POST", answer.action, FORM_TYPE, new URLSearchParams([...answer.fields]).toString()),
  );
  const [placed] = platform.deepLinked;

  return {
    login: { toolHost: new URL(frame.url).host, storageUrl: frame.storageUrl },
    launch: JSON.parse(textOf(launched)),
    graded: { label: graded.label, results: graded.results.map((result) => ({ ...result })) },
    kept: platform.gradebook.kept.map(({ lineItemId, score }) => ({
      lineItemId,
      userId: score.userId,
      scoreGiven: score.scoreGiven,
      timestamp: score.timestamp,
    })),
    deepLinked: {
      posted: { to: answer.action, fields: [...answer.fields.keys()] },
      status: received.status,
      data: placed?.data,
      message: placed?.message,
      items: (placed?.items ?? []).map((item) =>
        "properties" in item || item.type !== "ltiResourceLink"
          ? { type: item.type }
          : {
              type: item.type,
              title: item.title,
              url: item.url,
              custom: Object.fromEntries(item.custom ?? []),
              lineItem: item.lineItem && {
                scoreMaximum: item.lineItem.scoreMaximum,
                label: item.lineItem.label,
                resourceId: item.lineItem.resourceId,
              },
            },
      ),
    },
    replay,
  };
}

if (import.meta.main) console.log(JSON.stringify(await runScenario(), null, 2));
