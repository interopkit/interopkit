import { DataError, LimitError, readClock } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { checkHttpRequest, type HttpRequest, type HttpResponse, readForm } from "@interopkit/core/http";
import { LtiError } from "../errors.js";
import type { LtiMessage } from "../protocol/index.js";
import { callOptionsOf, readCookie, readMessage, verifyMigration } from "../protocol/internal.js";
import { verifyIdToken } from "./id-token.js";
import { stateCookieName } from "./login.js";
import { checkLaunchOptions, findRegistration, type LtiLaunchOptions } from "./options.js";
import { getDataPage, STORED_NONCE, STORED_STATE } from "./pages.js";
import type { PlatformRegistration } from "./registration.js";
import { checkLoginRecord, type LoginRecord } from "./store.js";

// The states that handleLogin creates are base64url; anything else is not one, and is not looked up in the store.
const STATE_FORMAT = /^[A-Za-z0-9_-]{1,64}$/u;
// The form of a launch holds an id_token and a state; an id_token with every claim of a launch is a few kilobytes.
const DEFAULT_MAX_FORM_BYTES = 65_536;

/** Reads a parameter of the launch that must be present, a non-empty string. */
function requiredField(form: ReadonlyMap<string, string>, name: string): string {
  const value = form.get(name);
  if (value === undefined || value === "") {
    throw new DataError(`The launch must have the form parameter ${describe(name)}, found ${describe(value)}.`);
  }
  return value;
}

/** Reads the form of a launch within its size limit. */
function readLaunchForm(request: HttpRequest, maxBytes: number): ReadonlyMap<string, string> {
  if (request.body.byteLength > maxBytes) {
    throw new LimitError(
      `The form of the launch has ${request.body.byteLength} bytes, above the limit of ${maxBytes} bytes of the option maxFormBytes.`,
      "maxFormBytes",
      maxBytes,
    );
  }
  return readForm(request);
}

/**
 * Refuses the authentication error response of a platform (Security Framework section 5.1.1.5, OpenID Connect Core section
 * 3.1.2.6): the form carries `error` in place of an `id_token`.
 */
function checkPlatformError(form: ReadonlyMap<string, string>): void {
  const error = form.get("error");
  if (error === undefined) return;
  const description = form.get("error_description");
  throw new LtiError(
    `The platform answered the authentication request with the error ${describe(error)}${description === undefined ? "" : ` (${describe(description)})`}.`,
    "platform-error",
  );
}

/** Checks that a launch carries the deployment and the target of the login it answers (LTI 1.3 Core sections 4.1.2 and 5.3.4). */
function checkLogin(launch: LtiMessage<string>, record: LoginRecord): void {
  if (record.deploymentId !== undefined && launch.deploymentId !== record.deploymentId) {
    throw new LtiError(
      `The deployment of the launch, ${describe(launch.deploymentId)}, is not the deployment ${describe(record.deploymentId)} of its login.`,
      "deployment-mismatch",
    );
  }
  if (launch.targetLinkUri !== record.targetLinkUri) {
    throw new LtiError(
      `The target_link_uri of the launch, ${describe(launch.targetLinkUri)}, is not the target ${describe(record.targetLinkUri)} of its login.`,
      "target-mismatch",
    );
  }
}

/** Decides the migration claim of a launch with the host's LTI 1.1 secret, when the host gives one for its consumer key. */
async function withMigration<TMessage extends LtiMessage<string>>(
  launch: TMessage,
  options: LtiLaunchOptions<string>,
): Promise<TMessage> {
  const { migration } = launch;
  if (migration === undefined || options.migrationSecret === undefined) return launch;
  const secret = await options.migrationSecret(migration.oauthConsumerKey, callOptionsOf(options));
  if (secret === undefined) return launch;
  if (typeof secret !== "string") {
    throw new DataError(
      `The option migrationSecret must resolve with a string or undefined, found ${describe(secret)}.`,
    );
  }
  return { ...launch, migration: { ...migration, verified: await verifyMigration(launch, secret) } };
}

/** Loads the record of the login that a launch answers. */
async function loadLogin(state: string, options: LtiLaunchOptions<string>): Promise<LoginRecord> {
  const record = STATE_FORMAT.test(state) ? await options.store.get(state, callOptionsOf(options)) : undefined;
  if (record === undefined) {
    throw new LtiError("The launch answers no login that the tool started, or one it has finished.", "state-unknown");
  }
  checkLoginRecord(record);
  if (readClock(options.clock) >= record.expiresAt) {
    throw new LtiError("The login that the launch answers has expired.", "state-expired");
  }
  return record;
}

/** Returns whether the browser of the launch is the browser of the login, as the cookie recorded it (Security Framework 1.1 sections 5.1.1.4 and 7.4.1). */
function hasStateCookie(request: HttpRequest, state: string): boolean {
  return readCookie(request, stateCookieName(state)) === state;
}

/** Returns whether a post is the verification page's: it returns values fetched from the platform's storage. */
function isVerification(form: ReadonlyMap<string, string>): boolean {
  return form.has(STORED_STATE) || form.has(STORED_NONCE);
}

/**
 * Checks the post of the verification page on the client-side storage path: it comes from the tool's own page, and the
 * values it fetched from the platform's storage are the login's.
 */
function checkVerification(
  request: HttpRequest,
  form: ReadonlyMap<string, string>,
  state: string,
  record: LoginRecord,
  registration: PlatformRegistration,
): void {
  // Without cookies nothing else ties the post to the browser that logged in: a cross-site form could post a token that the
  // attacker obtained, with values of its own choosing (login CSRF, Security Framework 1.1 section 7.4.1). The tool's own page is
  // same-origin.
  const origin = new URL(registration.redirectUri).origin;
  if (request.headers.origin !== origin) {
    throw new LtiError(
      `The verification of a launch must be posted from ${describe(origin)}, found ${describe(request.headers.origin)}.`,
      "origin-mismatch",
    );
  }
  if (form.get(STORED_STATE) !== state || form.get(STORED_NONCE) !== record.nonce) {
    throw new LtiError(
      "The state and the nonce in the platform's storage are not those of the login.",
      "storage-mismatch",
    );
  }
}

/**
 * Completes a launch: validates the `id_token` that the platform posts to the redirect URI and returns the launch.
 *
 * @remarks
 * The checks, in order: the form has at most `maxFormBytes`; it has no `oauth_consumer_key` (an LTI 1.0 to 1.2 launch) and no
 * `error` (the platform's authentication error response, Security Framework section 5.1.1.5), and has `id_token` and
 * `state`; `state` names a login that the tool started and has not finished; the browser is the one that logged in (the
 * state cookie, or the platform's storage); an algorithm of the registration, the signature, the issuer, the audiences, the
 * authorized party and the times (Security Framework section 5.1.3); the `nonce` equals the login's; the LTI claims of the
 * message type, with a version of `versions` and a deployment of the registration (LTI 1.3 Core section 5, Deep Linking 2.0
 * section 4.4, Submission Review 1.0 section 2, Proctoring Services 1.0 section 4); the deployment and the
 * `target_link_uri` of the login. With `migrationSecret` the migration claim is then verified. The login is deleted last, so a
 * launch completes once.
 *
 * The state cookie binds the launch whenever the browser kept it. When it did not and the login had `lti_storage_target`, as
 * in a frame whose browser blocks third-party cookies, the platform's post is answered with a verification page and no launch;
 * the page posts again to the same URL, and that second request completes the launch. The host routes both to this function.
 *
 * LTI 1.0 to 1.2 launches are not supported.
 *
 * @param request - The POST of the platform, or of the verification page.
 * @param options - The registrations and the store of the tool, and its `fetch` and clock.
 * @returns The launch, or the verification page, which the host sends.
 * @throws `DataError` when the request is not a POST of a form with `id_token` and `state`.
 * @throws `LtiError` with the reason of the failed check: `form-too-large`, `legacy-launch`, `platform-error`,
 * `state-unknown`, `state-expired`, `state-reused`, `state-cookie`, `origin-mismatch`, `storage-mismatch`, `platform-unknown`,
 * `token-malformed`, `algorithm-unsupported`, `key-unknown`, `signature-invalid`, `issuer-mismatch`, `audience-mismatch`,
 * `audience-untrusted`, `authorized-party-missing`, `authorized-party-mismatch`, `token-expired`, `issued-in-future`,
 * `nonce-mismatch`, `message-type-unsupported`, `version-unsupported`, `deployment-unknown`, `deployment-mismatch`,
 * `target-mismatch`, `claim-missing` or `claim-invalid`.
 * @throws `ServiceError` when the platform's key set cannot be fetched.
 * @throws The rejection of `options.migrationSecret`, and `DataError` when it resolves with something that is not a string.
 * @throws The `reason` of `options.signal` when it aborts before the login is deleted: the login stays.
 */
export async function handleLaunch<TOther extends string = never>(
  request: HttpRequest,
  options: LtiLaunchOptions<TOther>,
): Promise<LtiMessage<TOther> | HttpResponse> {
  checkHttpRequest(request);
  checkLaunchOptions(options);
  if (request.method !== "POST") {
    throw new DataError(`A launch must be a POST request, found ${describe(request.method)}.`);
  }
  const form = readLaunchForm(request, options.maxFormBytes ?? DEFAULT_MAX_FORM_BYTES);
  // 1EdTech retired LTI 1.0 to 1.2 on 2022-06-30; their launch is an OAuth 1.0a form with no id_token.
  if (form.has("oauth_consumer_key")) {
    throw new LtiError(
      "LTI 1.0 to 1.2 launches are not supported; an LTI 1.3 launch posts an id_token and a state.",
      "legacy-launch",
    );
  }
  checkPlatformError(form);
  const idToken = requiredField(form, "id_token");
  const state = requiredField(form, "state");
  const record = await loadLogin(state, options);
  const registration = await findRegistration(options, record.issuer, record.clientId);
  // The cookie binds the launch wherever the browser kept it; a login with a storage target falls back to the platform's
  // storage when it did not.
  if (!hasStateCookie(request, state)) {
    if (record.storageTarget === undefined) {
      throw new LtiError(
        "The state cookie of the login is missing or differs from the state of the launch.",
        "state-cookie",
      );
    }
    if (!isVerification(form)) {
      const { authenticationUrl, redirectUri } = registration;
      return getDataPage({
        frame: record.storageTarget,
        state,
        nonce: record.nonce,
        authenticationUrl,
        redirectUri,
        idToken,
      });
    }
    checkVerification(request, form, state, record, registration);
  }
  const claims = await verifyIdToken(idToken, registration, options.jwks, readClock(options.clock), options.signal);
  if (claims.nonce !== record.nonce) {
    throw new LtiError("The nonce of the token is not the nonce of the login.", "nonce-mismatch");
  }
  const message = readMessage(claims, {
    issuer: registration.issuer,
    clientId: registration.clientId,
    deploymentIds: registration.deploymentIds,
    ...(options.versions === undefined ? {} : { versions: options.versions }),
    ...(options.otherMessageTypes === undefined ? {} : { otherMessageTypes: options.otherMessageTypes }),
  });
  checkLogin(message, record);
  const launch = await withMigration(message, options);
  // The store removes the login for one caller only, so of two launches that race with one token, one completes.
  // An abort before this point leaves the login in the store, and the platform may post again; the delete is the point of
  // no return, after which the launch completes.
  options.signal?.throwIfAborted();
  if (!(await options.store.delete(state, callOptionsOf(options)))) {
    throw new LtiError("The login that the launch answers was finished by another request.", "state-reused");
  }
  return launch;
}
