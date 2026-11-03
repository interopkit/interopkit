import { callPort, DataError, readClock, signCompactJws } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { type HttpRequest, type HttpResponse, readForm, readQuery } from "@interopkit/core/http";
import { LtiError } from "../errors.js";
import type { MigrationClaim } from "../protocol/index.js";
import { renderPostPage, signConsumerKey, toSeconds, writeMessage } from "../protocol/internal.js";
import { methodNotAllowed, refusal, serverError, tooLarge } from "./answers.js";
import { openingKeys } from "./config.js";
import { LAUNCH_TTL_SECONDS } from "./login.js";
import { type MessageInput, readMessageInput } from "./messages/input.js";
import { substitute } from "./messages/substitution.js";
import { toWrite } from "./messages/write.js";
import type { PlatformSettings } from "./options.js";
import { readToolRegistration, type ToolRegistration } from "./registration.js";
import { serviceClaims } from "./services/routes.js";
import { type Hint, openHint, openLoginHint, sealDeepLinkingData, sealSessionData } from "./tokens.js";

/** The error of an authentication error response (OpenID Connect Core section 3.1.2.6) for the reason of a failed check. */
const RESPONSE_ERRORS: ReadonlyMap<string, string> = new Map([
  ["scope-invalid", "invalid_scope"],
  ["response-type-invalid", "unsupported_response_type"],
  ["hint-invalid", "login_required"],
  ["hint-expired", "login_required"],
  ["hint-used", "login_required"],
  ["client-mismatch", "login_required"],
  ["login-hint-mismatch", "login_required"],
  ["launch-refused", "access_denied"],
  ["deployment-unknown", "unauthorized_client"],
]);

const encoder = new TextEncoder();

/** What a port that failed leaves the route to answer: 500, with nothing of the cause. */
const FAILED = Symbol("failed");

/** Checks the parameters that have one value (Security Framework section 5.1.1.2). */
function checkFixed(parameters: ReadonlyMap<string, string>): void {
  const fixed: readonly (readonly [string, string, string])[] = [
    ["scope", "openid", "scope-invalid"],
    ["response_type", "id_token", "response-type-invalid"],
    ["response_mode", "form_post", "response-mode-invalid"],
    ["prompt", "none", "prompt-invalid"],
  ];
  for (const [name, expected, reason] of fixed) {
    if (parameters.get(name) !== expected) {
      throw new LtiError(
        `The parameter ${describe(name)} of the authentication request must be ${describe(expected)}, found ${describe(parameters.get(name))}.`,
        reason,
      );
    }
  }
}

/** Reads a parameter that the tool must send and that carries no meaning of its own, such as `state` and `nonce`. */
function requiredValue(parameters: ReadonlyMap<string, string>, name: string, reason: string): string {
  const value = parameters.get(name);
  if (value === undefined || value === "") {
    throw new LtiError(`The authentication request must have the parameter ${describe(name)}.`, reason);
  }
  return value;
}

/**
 * Opens the hint of the request and checks that it binds this request: it is sealed by this platform, not expired, for this
 * client, and `login_hint` names the same launch.
 */
async function bindHint(
  parameters: ReadonlyMap<string, string>,
  clientId: string,
  settings: PlatformSettings,
): Promise<Hint> {
  const keys = openingKeys(settings.config);
  const hint = await openHint(requiredValue(parameters, "lti_message_hint", "hint-missing"), keys);
  if (hint === undefined) {
    throw new LtiError("The lti_message_hint is not a hint that this platform issued.", "hint-invalid");
  }
  if (toSeconds(readClock(settings.clock)) >= hint.exp) {
    throw new LtiError("The lti_message_hint has expired.", "hint-expired");
  }
  if (hint.client !== clientId) {
    throw new LtiError("The lti_message_hint was issued for another tool.", "client-mismatch");
  }
  const loginHint = parameters.get("login_hint");
  if (loginHint === undefined || (await openLoginHint(loginHint, keys)) !== hint.id) {
    throw new LtiError("The login_hint does not name the launch of the lti_message_hint.", "login-hint-mismatch");
  }
  return hint;
}

/** Asks the host's `checkLaunch` about the launch of a hint and the request that carries it, when the host gave one. */
async function checkLaunch(
  hint: Hint,
  request: HttpRequest,
  settings: PlatformSettings,
): Promise<typeof FAILED | undefined> {
  const { checkLaunch: ask, signal } = settings;
  if (ask === undefined) return undefined;
  const launch = {
    clientId: hint.client,
    deploymentId: hint.deployment,
    ...(hint.principal === undefined ? {} : { principal: hint.principal }),
    request,
  };
  const asked = await callPort(() => ask(launch, { signal }), signal);
  if (asked === undefined) return FAILED;
  if (typeof asked.value !== "boolean") {
    throw new DataError(`The option checkLaunch must resolve with a boolean, found ${describe(asked.value)}.`);
  }
  if (!asked.value) throw new LtiError("The platform refused the launch.", "launch-refused");
  return undefined;
}

/** Takes the message of a hint from the `LaunchStore`, once, and checks that it is the message that the hint names. */
async function takeMessage(hint: Hint, settings: PlatformSettings): Promise<MessageInput | typeof FAILED> {
  const { signal } = settings;
  const taken = await callPort(() => settings.launches.take(hint.id, { signal }), signal);
  if (taken === undefined) return FAILED;
  if (taken.value === undefined) {
    throw new LtiError("The launch of the lti_message_hint has been used or has expired.", "hint-used");
  }
  const message = readMessageInput(taken.value, "The message that LaunchStore.take returned");
  if (
    message.clientId !== hint.client ||
    message.deploymentId !== hint.deployment ||
    message.user.subject !== hint.principal
  ) {
    throw new DataError(
      "LaunchStore.take returned the message of another launch than the one kept under the identifier.",
    );
  }
  return message;
}

/** What the claims of a launch need beside the message: its times and its nonce. */
interface Issue {
  readonly registration: ToolRegistration;
  readonly nonce: string;
  readonly iat: number;
  readonly exp: number;
}

/** Signs the consumer key of the migration claim with the secret of `migrationSecret`, when the host gives one for it. */
async function signMigration(
  message: MessageInput,
  issue: Issue,
  settings: PlatformSettings,
): Promise<MigrationClaim | undefined | typeof FAILED> {
  const { migration } = message;
  const { migrationSecret, signal } = settings;
  if (migration === undefined || migrationSecret === undefined) return undefined;
  const asked = await callPort(() => migrationSecret(migration.oauthConsumerKey, { signal }), signal);
  if (asked === undefined) return FAILED;
  const secret: unknown = asked.value;
  if (secret === undefined) return undefined;
  if (typeof secret !== "string") {
    throw new DataError(
      `The option migrationSecret must resolve with a string or undefined, found ${describe(secret)}.`,
    );
  }
  const parts = {
    consumerKey: migration.oauthConsumerKey,
    deploymentId: message.deploymentId,
    issuer: settings.config.issuer,
    clientId: message.clientId,
    expiresAt: issue.exp,
    nonce: issue.nonce,
  };
  return { ...migration, oauthConsumerKeySign: await signConsumerKey(parts, secret) };
}

/** Seals the data that a message carries for the tool to return: of a Deep Linking request, or of a proctored attempt. */
function sealData(message: MessageInput, issue: Issue, settings: PlatformSettings): Promise<string> | undefined {
  const { config } = settings;
  const bound = { client: message.clientId, deployment: message.deploymentId };
  if (message.messageType === "LtiDeepLinkingRequest") {
    const { data, ...requested } = message.settings;
    const exp = issue.iat + settings.deepLinkingLifetimeSeconds;
    return sealDeepLinkingData(
      { ...bound, settings: requested, ...(data === undefined ? {} : { data }), exp },
      config.hintKey,
    );
  }
  if (message.messageType === "LtiStartProctoring") {
    const exp = issue.iat + settings.sessionDataLifetimeSeconds;
    const subject = message.user.subject;
    const session = {
      ...bound,
      resourceLink: message.resourceLink.id,
      attempt: message.attemptNumber,
      ...(subject === undefined ? {} : { subject }),
      exp,
    };
    return sealSessionData(session, config.hintKey);
  }
  return undefined;
}

/** Builds and signs the `id_token` of a message that was taken from the store. */
async function issueIdToken(
  message: MessageInput,
  issue: Issue,
  settings: PlatformSettings,
): Promise<string | typeof FAILED> {
  const { config, signal } = settings;
  const { registration } = issue;
  const services = serviceClaims(message, registration, settings);
  const custom = await substitute(
    { ...registration.custom, ...message.custom },
    {
      view: { message, instance: config.instance, services },
      tool: registration,
      substitution: settings.substitution,
      signal,
    },
  );
  if (custom === undefined) return FAILED;
  const migration = await signMigration(message, issue, settings);
  if (migration === FAILED) return FAILED;
  const sealed = await sealData(message, issue, settings);
  const claims = {
    ...writeMessage(
      toWrite(message, { issuer: config.issuer, instance: config.instance, custom, migration, services, sealed }),
    ),
    iss: config.issuer,
    aud: message.clientId,
    iat: issue.iat,
    exp: issue.exp,
    nonce: issue.nonce,
  };
  const payload = encoder.encode(JSON.stringify(claims));
  const signed = await callPort(() => signCompactJws({ typ: "JWT" }, payload, config.keys.signer, { signal }), signal);
  return signed === undefined ? FAILED : signed.value;
}

/**
 * Checks an authentication request whose client and redirect URI are known, and issues its `id_token`. A refusal throws an
 * `LtiError`, which goes back to the tool as an authentication error response.
 */
async function authorize(
  request: HttpRequest,
  { parameters, registration }: Pick<Addressed, "parameters" | "registration">,
  settings: PlatformSettings,
): Promise<readonly [string, string][] | typeof FAILED> {
  checkFixed(parameters);
  const nonce = requiredValue(parameters, "nonce", "nonce-missing");
  const state = requiredValue(parameters, "state", "state-missing");
  const hint = await bindHint(parameters, registration.clientId, settings);
  // The host's own check runs before `take`, so that a refused check does not spend the launch.
  if ((await checkLaunch(hint, request, settings)) === FAILED) return FAILED;
  // An abort before `take` leaves the launch unspent, since `callPort` checks the signal first. Once it is taken, a later abort
  // fails closed: the tool starts again.
  const message = await takeMessage(hint, settings);
  if (message === FAILED) return FAILED;
  if (!registration.deploymentIds.includes(message.deploymentId)) {
    throw new LtiError(
      `The deployment ${describe(message.deploymentId)} is no longer one of the deployments of the tool.`,
      "deployment-unknown",
    );
  }
  const iat = toSeconds(readClock(settings.clock));
  const idToken = await issueIdToken(message, { registration, nonce, iat, exp: iat + LAUNCH_TTL_SECONDS }, settings);
  if (idToken === FAILED) return FAILED;
  return [
    ["id_token", idToken],
    ["state", state],
  ];
}

/** The tool of an authentication request and where its answers go, once both are known. */
interface Addressed {
  readonly parameters: ReadonlyMap<string, string>;
  readonly registration: ToolRegistration;
  readonly redirectUri: string;
}

/**
 * Reads the parameters of the authentication request, which the tool may send as a GET or as a form POST (OpenID Connect Core
 * section 3.1.2.1), and finds the tool and its redirect URI. Until both are known a failure is answered to the browser, since
 * nothing says where else it may go.
 */
async function address(request: HttpRequest, settings: PlatformSettings): Promise<Addressed | HttpResponse> {
  if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed(request.method, "GET, POST");
  if (request.body.byteLength > settings.maxBodyBytes) return tooLarge(request.body.byteLength, settings.maxBodyBytes);
  let parameters: ReadonlyMap<string, string>;
  try {
    parameters = request.method === "GET" ? readQuery(request) : readForm(request);
  } catch (error) {
    if (error instanceof DataError) return refusal(400, "invalid_request", error.message);
    throw error;
  }
  const clientId = parameters.get("client_id") ?? "";
  if (clientId === "") return refusal(400, "invalid_request", "The authentication request must have a client_id.");
  const { signal } = settings;
  const asked = await callPort(() => settings.client(clientId, { signal }), signal);
  if (asked === undefined) return serverError();
  const registration = readToolRegistration(asked.value, clientId);
  if (registration === undefined) {
    return refusal(
      400,
      "invalid_request",
      `The platform has no tool with the client identifier ${describe(clientId)}.`,
    );
  }
  const redirectUri = parameters.get("redirect_uri");
  if (redirectUri === undefined || !registration.redirectUris.includes(redirectUri)) {
    return refusal(
      400,
      "invalid_request",
      `The redirect_uri must be one of the redirect URIs of the tool, found ${describe(redirectUri)}.`,
    );
  }
  return { parameters, registration, redirectUri };
}

/**
 * Answers the tool's authentication request (Security Framework sections 5.1.1.2, 5.1.1.3 and 5.1.1.5): the route `/authorize`
 * of `handlePlatformRequest`.
 *
 * @remarks
 * Until the client and its redirect URI are known, a failure is answered to the browser: 405, 413, 400, or 500 when the lookup
 * fails. After that, a refusal is the authentication error response, posted to the redirect URI with `error`,
 * `error_description` and `state`, under the status of the refusal. The checks after the redirect URI, in order: the fixed
 * parameters, `nonce` and `state`, the hint and the `login_hint`, `checkLaunch`, and the single `take` of the message, whose
 * deployment must still be the tool's. A port that fails answers 500 and signs nothing.
 */
export async function answerAuthorization(request: HttpRequest, settings: PlatformSettings): Promise<HttpResponse> {
  const addressed = await address(request, settings);
  if ("status" in addressed) return addressed;
  const { parameters, registration, redirectUri } = addressed;
  const frameOrigin = settings.config.frameOrigin;
  try {
    const fields = await authorize(request, { parameters, registration }, settings);
    if (fields === FAILED) return serverError();
    return await renderPostPage({ action: redirectUri, fields, frameAncestors: frameOrigin });
  } catch (error) {
    if (!(error instanceof LtiError)) throw error;
    const state = parameters.get("state");
    const fields: [string, string][] = [
      ["error", RESPONSE_ERRORS.get(error.reason) ?? "invalid_request"],
      ["error_description", error.message],
    ];
    if (state !== undefined) fields.push(["state", state]);
    return {
      ...(await renderPostPage({ action: redirectUri, fields, frameAncestors: frameOrigin })),
      status: error.status,
    };
  }
}
