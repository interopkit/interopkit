// biome-ignore-all lint/style/useNamingConvention: the names of the form fields are those of LTI, in snake_case.

import type { Clock } from "@interopkit/core";
import { generateSigningKeys } from "./src/keys.ts";
import { connect, plainRequest, textOf } from "./src/network.ts";
import { createPlatform } from "./src/platform.ts";
import { setupPlatform } from "./src/platform-setup.ts";
import { createTool } from "./src/tool.ts";
import { setupTool } from "./src/tool-setup.ts";

const TOOL_ORIGIN = "https://tool.example";
const CLIENT_ID = "962fa4d8-bcbf-49a0-94b2-2de05ad274af";
const DEPLOYMENT_ID = "07940580-b309-415e-a37c-914d387c1150";
const KEY_ID = "tool-1";
const NOW = 1_700_000_000_000;

/** What the scenario shows: the launch the tool accepted, and the replay the platform refused. */
export interface Outcome {
  readonly login: { readonly toolHost: string; readonly storageUrl: string };
  readonly launch: Readonly<Record<string, unknown>>;
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

/** Reads the form that the platform's page posts: the `id_token` and the `state`, or the `error`, and where they go. */
function formOf(page: string): { action: string; idToken: string; state: string; error: string } {
  const field = (name: string) => new RegExp(`name="${name}" value="([^"]*)"`, "u").exec(page)?.[1] ?? "";
  return {
    action: /<form id="form" method="post" action="([^"]*)"/u.exec(page)?.[1] ?? "",
    idToken: field("id_token"),
    state: field("state"),
    error: field("error"),
  };
}

/**
 * Launches a tool from a platform, each side with the role of this package, over an in-memory network. The steps are those of
 * the browser: the platform keeps the message and prepares the login URL, the browser asks the tool, then the platform to
 * authenticate, then posts the `id_token` to the tool.
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

  // The platform keeps the message of the launch of the tool for a resource of the host.
  const frame = await platform.frame({
    messageType: "LtiResourceLinkRequest",
    clientId: CLIENT_ID,
    deploymentId: DEPLOYMENT_ID,
    targetLinkUri: `${TOOL_ORIGIN}/lti/launch`,
    user: { subject: "candidate-7" },
    roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
    context: { id: "course-1", title: "Tryout" },
    resourceLink: { id: "session-1-question-4", title: "Drawing tool" },
    custom: { exam: "tryout-1", user: "$User.id" },
  });
  // The browser opens the frame. The platform asks for client-side login, so the tool answers with a page that keeps its
  // `state` and `nonce` in the platform's storage and then sends the browser to the platform to authenticate.
  const login = await tool.handle(plainRequest("GET", frame.url));
  const stored = configOf(textOf(login));
  const storage = new Map([
    [`state_${stored.state}`, stored.state ?? ""],
    [`nonce_${stored.nonce}`, stored.nonce ?? ""],
  ]);
  const authenticationRequest = stored.authenticationRequest ?? "";
  const authentication = await platform.handle(plainRequest("GET", authenticationRequest));
  const form = formOf(textOf(authentication));
  const formType = { "content-type": "application/x-www-form-urlencoded" };
  const fields = { id_token: form.idToken, state: form.state };
  // The platform's post is answered with a page that fetches the stored values; the browser posts them back from the tool's origin.
  const verification = await tool.handle(
    plainRequest("POST", form.action, { ...formType, origin: platform.origin }, new URLSearchParams(fields).toString()),
  );
  const fetched = configOf(textOf(verification));
  const verified = new URLSearchParams({
    ...fields,
    stored_state: storage.get(`state_${fetched.state}`) ?? "",
    stored_nonce: storage.get(`nonce_${fetched.nonce}`) ?? "",
  });
  const launched = await tool.handle(
    plainRequest("POST", form.action, { ...formType, origin: TOOL_ORIGIN }, verified.toString()),
  );
  const launch = tool.launches[0];
  if (launch === undefined) throw new Error(`The tool did not accept the launch: ${launched.status}.`);

  // The authentication request of a launch is answered once: the message is taken, so the same request a second time gets
  // the authentication error response, which the page posts to the tool.
  const again = await platform.handle(plainRequest("GET", authenticationRequest));
  const replay = { status: again.status, error: formOf(textOf(again)).error };

  return {
    login: { toolHost: new URL(frame.url).host, storageUrl: frame.storageUrl },
    launch: JSON.parse(textOf(launched)),
    replay,
  };
}

if (import.meta.main) console.log(JSON.stringify(await runScenario(), null, 2));
