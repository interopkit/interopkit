// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the entries quote source code, which holds template strings.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/**
 * A rule of the code that a test must guard. Replacing `find` with `replace` in `file` removes the rule and leaves valid
 * code, and the test file `test` must then fail: a test that still passes does not guard the rule.
 */
export interface Rule {
  /** What the rule says, as a sentence. */
  readonly rule: string;
  /** The source file that holds the rule, relative to the repository root. */
  readonly file: string;
  /** The text of the file that implements the rule. It occurs once. */
  readonly find: string;
  /** The text that stands in its place without the rule, and does the rest. */
  readonly replace: string;
  /** The test file that guards the rule, relative to the repository root. */
  readonly test: string;
}

/** The security-critical rules, each with the test that guards it. A package adds its own rules here. */
export const RULES: readonly Rule[] = [
  {
    rule: "A service call never follows a redirect.",
    file: "packages/core/src/service.ts",
    find: '{ ...init, redirect: "manual", signal }',
    replace: '{ ...init, redirect: "follow", signal }',
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "An answer that is not 2xx is an error with its status and body.",
    file: "packages/core/src/service.ts",
    find: "if (!response.ok) throw",
    replace: "if (false) throw",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "An answer of more than 65,536 bytes is refused, and reading stops there.",
    file: "packages/core/src/service.ts",
    find: "if (bytes > MAX_RESPONSE_BYTES) {",
    replace: "if (false) {",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "The chunk that crosses the size limit is read up to the limit, so that the error body does not depend on the chunks.",
    file: "packages/core/src/service.ts",
    find: "value.subarray(0, room)",
    replace: "value.subarray(0, 0)",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "An answer that a fetch followed to another address is a redirect.",
    file: "packages/core/src/service.ts",
    find: "response.redirected || ",
    replace: "",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "The reader of a body is cancelled when the call stops reading.",
    file: "packages/core/src/service.ts",
    find: "if (!finished) reader.cancel().catch(ignore);",
    replace: "if (!finished) ignore();",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "The wait for the answer ends at the deadline, even when fetch ignores its signal.",
    file: "packages/core/src/service.ts",
    find: "response = await untilAborted(pending, signal);",
    replace: "response = await pending;",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "The wait for the body ends at the deadline, even when the body stalls.",
    file: "packages/core/src/service.ts",
    find: "await untilAborted(reader.read(), signal);",
    replace: "await reader.read();",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "A caller's abort rejects with the reason of its signal and not with a ServiceError.",
    file: "packages/core/src/service.ts",
    find: "if (service.signal?.aborted) return service.signal.reason;",
    replace: "if (false) return service.signal?.reason;",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "A signal that is aborted before the call makes no request.",
    file: "packages/core/src/service.ts",
    find: "service.signal?.throwIfAborted();",
    replace: "",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "A signal that aborts before the wait begins still ends the wait.",
    file: "packages/core/src/until-aborted.ts",
    find: "if (signal.aborted) abort();",
    replace: "",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "The body of an answer that arrives after the call gave up is released.",
    file: "packages/core/src/service.ts",
    find: "if (response === undefined) release(pending);",
    replace: "",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "fetch is called as a bare function, never as a method of the options.",
    file: "packages/core/src/service.ts",
    find: "Promise.resolve(call(url,",
    replace: "Promise.resolve(service.fetch(url,",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "A URL that is not https is refused.",
    file: "packages/core/src/checks.ts",
    find: 'return new URL(text).protocol === "https:";',
    replace: 'return new URL(text).protocol !== "";',
    test: "packages/core/test/checks.test.ts",
  },
  {
    rule: "The endpoint of the sensor must be https, so that the bearer token never travels in the clear.",
    file: "packages/learning-analytics/src/send/send-caliper.ts",
    find: 'checkHttpsUrl(value.endpoint, "The option endpoint");',
    replace: "",
    test: "packages/learning-analytics/test/send.test.ts",
  },
  {
    rule: "The bearer token must have the form of RFC 6750, so that it cannot carry a line break into a header.",
    file: "packages/learning-analytics/src/send/send-caliper.ts",
    find: "if (!BEARER_TOKEN.test(value.token)) {",
    replace: "if (false) {",
    test: "packages/learning-analytics/test/send.test.ts",
  },
  {
    rule: "The sensor sends through callService, so that it follows no redirect and waits no longer than the deadline.",
    file: "packages/learning-analytics/src/send/send-caliper.ts",
    find: "await callService({ fetch, timeoutMs, signal },",
    replace:
      'await ((_service: unknown, _what: string, url: string, init: object) => fetch(url, { ...init, redirect: "follow" } as never).then(() => ""))({ fetch, timeoutMs, signal },',
    test: "packages/learning-analytics/test/send.test.ts",
  },
  {
    rule: "An envelope is never sent without an event.",
    file: "packages/learning-analytics/src/send/send-caliper.ts",
    find: "if (events.length === 0) throw",
    replace: "if (false) throw",
    test: "packages/learning-analytics/test/send.test.ts",
  },
  {
    rule: "The envelope carries the time of this send, in the form of Caliper.",
    file: "packages/learning-analytics/src/send/send-caliper.ts",
    find: 'sendTime: caliperTime(sendTime, "The option sendTime"),',
    replace: "sendTime: String(sendTime),",
    test: "packages/learning-analytics/test/send.test.ts",
  },
  {
    rule: "An event identifier names the JSON text of its parts, so that parts which a plain join confuses stay apart.",
    file: "packages/learning-analytics/src/build/identifier.ts",
    find: "v5(JSON.stringify(checked), CALIPER_NAMESPACE)",
    replace: 'v5(checked.join("/"), CALIPER_NAMESPACE)',
    test: "packages/learning-analytics/test/build.test.ts",
  },
  {
    rule: "The namespace of the identifiers never changes.",
    file: "packages/learning-analytics/src/build/identifier.ts",
    find: 'CALIPER_NAMESPACE = "4bcd2e8b-df2f-56d9-b6c1-d17e5077c977"',
    replace: 'CALIPER_NAMESPACE = "4bcd2e8b-df2f-56d9-b6c1-d17e5077c978"',
    test: "packages/learning-analytics/test/build.test.ts",
  },
  {
    rule: "A part of an identifier that is not finite is refused, because JSON writes it as null.",
    file: "packages/learning-analytics/src/build/identifier.ts",
    find: "v.union([v.string(), finiteSchema]",
    replace: "v.union([v.string(), v.number()]",
    test: "packages/learning-analytics/test/build.test.ts",
  },
  {
    rule: "A time that Caliper cannot write is refused.",
    file: "packages/learning-analytics/src/build/time.ts",
    find: "at < 0 || at > LAST_TIME",
    replace: "at < -1e300 || at > 1e300",
    test: "packages/learning-analytics/test/build.test.ts",
  },
  {
    rule: "A token is verified with RS256 only: none and the HMAC algorithms are refused.",
    file: "packages/tool-integration/src/protocol/jwt.ts",
    find: "algorithms: [ALGORITHM],",
    replace: "",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "A token names its key with a kid.",
    file: "packages/tool-integration/src/protocol/jwt.ts",
    find: 'if (typeof header.kid !== "string" || header.kid === "") {',
    replace: "if (false) {",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "The audience of a token is the one party, and no other.",
    file: "packages/tool-integration/src/protocol/jwt.ts",
    find: "checkSoleAudience(claims, expected.audience);",
    replace: "",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "A token issued in the future is refused, beyond the leeway for clock skew.",
    file: "packages/tool-integration/src/protocol/jwt.ts",
    find: "checkIssuedAt(claims, nowMilliseconds / 1000);",
    replace: "",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "A token that expired is refused, beyond the leeway for clock skew.",
    file: "packages/tool-integration/src/protocol/jwt.ts",
    find: "clockTolerance: CLOCK_SKEW_SECONDS,",
    replace: "clockTolerance: 31_536_000,",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "A token part is the one canonical base64url of some bytes.",
    file: "packages/tool-integration/src/protocol/jwt.ts",
    find: "return parts.length === 3 && parts.every(isCanonicalBase64Url);",
    replace: "return parts.length === 3;",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "An LTI 1.0 to 1.2 launch is refused.",
    file: "packages/tool-integration/src/tool/launch.ts",
    find: 'if (form.has("oauth_consumer_key")) {',
    replace: "if (false) {",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "A login that has expired is refused.",
    file: "packages/tool-integration/src/tool/launch.ts",
    find: "if (readClock(options.clock) >= record.expiresAt) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "The browser of a launch on the cookie path is the browser that logged in.",
    file: "packages/tool-integration/src/tool/launch.ts",
    find: "checkStateCookie(request, state);",
    replace: "",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "The verification of the storage path is posted from the origin of the tool.",
    file: "packages/tool-integration/src/tool/launch.ts",
    find: "if (request.headers.origin !== origin) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "The state and nonce in the platform's storage are those of the login.",
    file: "packages/tool-integration/src/tool/launch.ts",
    find: "if (form.get(STORED_STATE) !== state || form.get(STORED_NONCE) !== record.nonce) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "The nonce of the token is the nonce of the login.",
    file: "packages/tool-integration/src/tool/launch.ts",
    find: "if (claims.nonce !== record.nonce) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "A login completes once: only one caller's delete succeeds.",
    file: "packages/tool-integration/src/tool/launch.ts",
    find: "if (!(await options.store.delete(state, callOptionsOf(options)))) {",
    replace: "await options.store.delete(state, callOptionsOf(options));\n  if (false) {",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "An aborted launch leaves the login in the store.",
    file: "packages/tool-integration/src/tool/launch.ts",
    find: "  options.signal?.throwIfAborted();\n  if (!(await options.store.delete(state, callOptionsOf(options)))) {",
    replace: "  if (!(await options.store.delete(state, callOptionsOf(options)))) {",
    test: "packages/tool-integration/test/tool-signals.test.ts",
  },
  {
    rule: "The authorized party of a token is the client of the tool.",
    file: "packages/tool-integration/src/tool/id-token.ts",
    find: "if (azp !== undefined && azp !== clientId) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "The deployment of a launch is one that the registration lists.",
    file: "packages/tool-integration/src/tool/launch-claims.ts",
    find: "if (!registration.deploymentIds.includes(deploymentId)) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "A registration matches the issuer and the client of the message.",
    file: "packages/tool-integration/src/tool/options.ts",
    find: "if (registration.issuer !== issuer || (clientId !== undefined && registration.clientId !== clientId)) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "The state cookie is Secure, HttpOnly and SameSite=None.",
    file: "packages/tool-integration/src/tool/login.ts",
    find: "Path=/; Secure; HttpOnly; SameSite=None",
    replace: "Path=/",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "The assertion for the token endpoint is for that endpoint.",
    file: "packages/tool-integration/src/tool/access-token.ts",
    find: ".setAudience(registration.accessTokenUrl)",
    replace: ".setAudience(registration.issuer)",
    test: "packages/tool-integration/test/tool.test.ts",
  },
  {
    rule: "A score is published only with the scope that the platform granted.",
    file: "packages/tool-integration/src/tool/publish-ags-score.ts",
    find: "const missing = needed.find((scope) => !token.scopes.includes(scope));",
    replace: "const missing = undefined;",
    test: "packages/tool-integration/test/tool-score.test.ts",
  },
  {
    rule: "A score is published only when the launch offers the score scope.",
    file: "packages/tool-integration/src/tool/publish-ags-score.ts",
    find: "if (!scopes.includes(AGS_SCOPE.score)) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/tool-score.test.ts",
  },
  {
    rule: "A score has a timestamp with a time zone.",
    file: "packages/tool-integration/src/tool/publish-ags-score.ts",
    find: "(text) => TIMESTAMP.test(text) && !Number.isNaN(Date.parse(text)),",
    replace: "(text) => !Number.isNaN(Date.parse(text)),",
    test: "packages/tool-integration/test/tool-score.test.ts",
  },
  {
    rule: "A launch has a principal of at most 255 characters.",
    file: "packages/tool-integration/src/platform/tool-launch.ts",
    find: "if (value.principal.length > MAX_IDENTIFIER_LENGTH) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A resource has at most 1,024 characters.",
    file: "packages/tool-integration/src/platform/tool-launch.ts",
    find: "if (value.resource.length > MAX_RESOURCE_LENGTH) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "The highest score of a launch is above 0.",
    file: "packages/tool-integration/src/platform/tool-launch.ts",
    find: "if (!v.is(POSITIVE_NUMBER, value.scoreMaximum)) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "The host confirms the launch before the platform looks for the tool.",
    file: "packages/tool-integration/src/platform/login.ts",
    find: "  await options.check(launch, call);\n",
    replace: "",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A tool is never launched from an origin of the platform.",
    file: "packages/tool-integration/src/platform/login.ts",
    find: "refuseOwnOrigins([launch.target, registration.loginUrl, ...registration.redirectUris], config);",
    replace: "",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "An authentication request is for the origin of the platform.",
    file: "packages/tool-integration/src/platform/options.ts",
    find: "if (new URL(request.url).origin !== config.origin) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "An authentication request has the fixed parameters of the protocol.",
    file: "packages/tool-integration/src/platform/authorize.ts",
    find: "if (parameters.get(name) !== expected) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "The redirect URI of an authentication request is one of the tool's.",
    file: "packages/tool-integration/src/platform/authorize.ts",
    find: "!registration.redirectUris.includes(redirectUri)",
    replace: "false",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A hint expires.",
    file: "packages/tool-integration/src/platform/authorize.ts",
    find: "if (Math.floor(readClock(options.clock) / 1000) >= hint.exp) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A hint is for the tool that sends it.",
    file: "packages/tool-integration/src/platform/authorize.ts",
    find: "if (hint.client !== clientId) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "The login_hint names the principal of the hint.",
    file: "packages/tool-integration/src/platform/authorize.ts",
    find: "(await openLoginHint(loginHint, options.config.hintKey)) !== hint.principal",
    replace: "false",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A hint is single-use.",
    file: "packages/tool-integration/src/platform/authorize.ts",
    find: "if (!(await options.once(`hint:${hint.jti}`, hint.exp * 1000, callOptionsOf(options)))) {",
    replace: "await options.once(`hint:${hint.jti}`, hint.exp * 1000, callOptionsOf(options));\n  if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "The check of the launch runs before the hint is spent.",
    file: "packages/tool-integration/src/platform/authorize.ts",
    find: "  await options.checkLaunch?.({ principal: hint.principal, resource: hint.resource }, callOptionsOf(options));\n",
    replace: "",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "An abort before the hint is spent leaves it unspent.",
    file: "packages/tool-integration/src/platform/authorize.ts",
    find: "  // An abort before `once` leaves the hint unspent. Once it is spent, a later abort fails closed: the tool starts again.\n  options.signal?.throwIfAborted();\n",
    replace: "",
    test: "packages/tool-integration/test/platform-failures.test.ts",
  },
  {
    rule: "An assertion expires within an hour.",
    file: "packages/tool-integration/src/platform/token.ts",
    find: "if (exp - nowMilliseconds / 1000 > MAX_ASSERTION_LIFETIME_SECONDS) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "The jti of an assertion is single-use.",
    file: "packages/tool-integration/src/platform/token.ts",
    find: "if (!(await options.once(`assertion:${clientId}:${jti}`, expiresAt, callOptionsOf(options)))) {",
    replace: "await options.once(`assertion:${clientId}:${jti}`, expiresAt, callOptionsOf(options));\n  if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "The jti of an assertion is remembered through the clock-skew leeway, as long as the assertion verifies.",
    file: "packages/tool-integration/src/platform/token.ts",
    find: "const expiresAt = (exp + CLOCK_SKEW_SECONDS) * 1000;",
    replace: "const expiresAt = exp * 1000;",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "An assertion has a non-empty jti.",
    file: "packages/tool-integration/src/platform/token.ts",
    find: 'required(claims, "jti", OWNER, NON_EMPTY_STRING)',
    replace: 'required(claims, "jti", OWNER, STRING)',
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A key for RS256 has at least 2,048 bits.",
    file: "packages/tool-integration/src/protocol/keys.ts",
    find: "algorithm.modulusLength >= MIN_RSA_MODULUS_BITS &&",
    replace: "true &&",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "The hint key has at least 256 bits.",
    file: "packages/tool-integration/src/platform/config.ts",
    find: "algorithm.length >= MIN_HMAC_KEY_BITS &&",
    replace: "true &&",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "The title of a launch has at most 255 characters, because it travels in the login URL.",
    file: "packages/tool-integration/src/platform/tool-launch.ts",
    find: "if (value.title.length > MAX_TITLE_LENGTH) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "The custom properties of a launch have at most 2,048 characters, because they travel in the login URL.",
    file: "packages/tool-integration/src/platform/tool-launch.ts",
    find: "if (customLength > MAX_CUSTOM_LENGTH) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A time zone of a score is at most 23:59 from UTC.",
    file: "packages/tool-integration/src/platform/ags-score.ts",
    find: "if (zoneHours > MAX_ZONE_HOURS || zoneMinutes > MAX_ZONE_MINUTES) return undefined;",
    replace: "if (false) return undefined;",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "Only the scopes the platform offers are granted.",
    file: "packages/tool-integration/src/platform/token.ts",
    find: "const unknown = scopes.find((scope) => !OFFERED_SCOPES.includes(scope));",
    replace: "const unknown = undefined;",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "An access token expires.",
    file: "packages/tool-integration/src/platform/access.ts",
    find: "if (access === undefined || Math.floor(readClock(options.clock) / 1000) >= access.exp) {",
    replace: "if (access === undefined) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A service needs one of the scopes of its request.",
    file: "packages/tool-integration/src/platform/access.ts",
    find: "if (!access.scopes.some((scope) => needed.includes(scope))) {",
    replace: "if (false) {",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A tool reads only its own line item.",
    file: "packages/tool-integration/src/platform/ags.ts",
    find: "  const { lineItem, url } = found;\n  if (lineItem.client !== access.client)",
    replace: "  const { lineItem, url } = found;\n  if (false)",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A tool posts scores only to its own line item.",
    file: "packages/tool-integration/src/platform/ags.ts",
    find: "  const { lineItem } = found;\n  if (lineItem.client !== access.client)",
    replace: "  const { lineItem } = found;\n  if (false)",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A score is for the user of the launch.",
    file: "packages/tool-integration/src/platform/ags.ts",
    find: "if (score.userId !== lineItem.subject)",
    replace: "if (false)",
    test: "packages/tool-integration/test/platform.test.ts",
  },
  {
    rule: "A sealed token is for one use.",
    file: "packages/tool-integration/src/platform/seal.ts",
    find: "protectedHeader.typ === use &&",
    replace: "true &&",
    test: "packages/tool-integration/test/platform-failures.test.ts",
  },
  {
    rule: "A sealed token is the one canonical spelling.",
    file: "packages/tool-integration/src/platform/seal.ts",
    find: "  if (!hasCanonicalParts(token)) return undefined;\n",
    replace: "",
    test: "packages/tool-integration/test/platform-failures.test.ts",
  },
];

/** The folders that a scratch copy leaves out: generated output and installed packages, which it links instead. */
const SKIPPED = new Set(["node_modules", ".git", "dist", "coverage", ".cache", ".vitest"]);
/** The longest a test of a mutated copy may take, in milliseconds: a removed deadline makes a test wait for ever. */
const TEST_TIMEOUT_MS = 5_000;

/** What checking one rule found. */
export interface Verdict {
  readonly guarded: boolean;
  /** A sentence that says what happened and, when the rule is not guarded, what to do. */
  readonly message: string;
}

/**
 * Removes a rule from the text of its file.
 *
 * @throws `Error` when the text to replace does not occur exactly once.
 */
export function removeRule(source: string, rule: Rule): string {
  const count = source.split(rule.find).length - 1;
  if (count !== 1)
    throw new Error(`${rule.file} holds ${JSON.stringify(rule.find)} ${count} times; the rule needs it exactly once.`);
  return source.replace(rule.find, () => rule.replace);
}

/** Returns the number of failed tests in the report of a Vitest run, or `undefined` when the run did not run tests. */
export function failedTests(report: string): number | undefined {
  const summary = /^\s*Tests\s+(.*)$/m.exec(report)?.[1];
  if (summary === undefined || !/\d+ (?:failed|passed)/.test(summary)) return undefined;
  return Number(/(\d+) failed/.exec(summary)?.[1] ?? 0);
}

/** The folders directly below a folder of the repository, if it exists. */
function foldersIn(root: string, folder: string): string[] {
  const parent = join(root, folder);
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name));
}

/** Copies the repository into a scratch directory without generated output, and links the installed packages. */
function copyRepository(root: string, scratch: string): void {
  cpSync(root, scratch, { recursive: true, filter: (path) => !SKIPPED.has(basename(path)) });
  for (const directory of [root, ...foldersIn(root, "packages"), ...foldersIn(root, "examples")]) {
    const modules = join(directory, "node_modules");
    if (existsSync(modules)) symlinkSync(modules, join(scratch, directory.slice(root.length), "node_modules"));
  }
}

/** Runs one test file of a copy with Vitest and returns what it reported. */
function runTest(
  root: string,
  scratch: string,
  test: string,
): { readonly failed: number | undefined; readonly report: string } {
  const vitest = join(root, "node_modules/vitest/vitest.mjs");
  const run = spawnSync(process.execPath, [vitest, "run", "--maxWorkers=2", `--testTimeout=${TEST_TIMEOUT_MS}`, test], {
    cwd: scratch,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    timeout: 300_000,
  });
  const report = `${run.stdout}${run.stderr}`;
  return { failed: failedTests(report), report };
}

/**
 * Checks that the test of a rule passes on the code, and fails on a copy of the code without the rule.
 *
 * @param root - The repository.
 * @param rule - The rule.
 * @param passing - The test files that already passed on the unchanged code, which a run of many rules does not run again.
 */
export function checkRule(root: string, rule: Rule, passing: Set<string> = new Set()): Verdict {
  const scratch = mkdtempSync(join(tmpdir(), "interopkit-rule-"));
  try {
    copyRepository(root, scratch);
    const baseline = passing.has(rule.test) ? { failed: 0, report: "" } : runTest(root, scratch, rule.test);
    if (baseline.failed === 0) passing.add(rule.test);
    if (baseline.failed !== 0)
      return {
        guarded: false,
        message: `${rule.test} does not pass on the unchanged code; fix it first.\n${baseline.report}`,
      };
    const path = join(scratch, rule.file);
    writeFileSync(path, removeRule(readFileSync(path, "utf8"), rule));
    const mutated = runTest(root, scratch, rule.test);
    if (mutated.failed === undefined)
      return {
        guarded: false,
        message: `${rule.test} did not run on the copy without the rule; the replacement may be invalid code.\n${mutated.report}`,
      };
    if (mutated.failed === 0)
      return {
        guarded: false,
        message: `${rule.test} passes without the rule: add a test that fails when "${rule.rule}" is broken.`,
      };
    return {
      guarded: true,
      message: `${mutated.failed} ${mutated.failed === 1 ? "test fails" : "tests fail"} without the rule.`,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Checks every rule, or the rules of the given files, and returns the exit code. */
function main(paths: readonly string[]): number {
  const root = resolve(dirname(import.meta.dirname));
  const rules = RULES.filter(({ file }) => paths.length === 0 || paths.some((path) => file.startsWith(path)));
  let unguarded = 0;
  const passing = new Set<string>();
  for (const rule of rules) {
    const { guarded, message } = checkRule(root, rule, passing);
    if (!guarded) unguarded += 1;
    console.log(`${guarded ? "guarded  " : "UNGUARDED"} ${rule.rule} ${message}`);
  }
  console.log(
    unguarded === 0 ? `Every one of ${rules.length} rules is guarded.` : `${unguarded} rules are not guarded.`,
  );
  return unguarded === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
