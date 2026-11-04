# @interopkit/core

The shared foundation of the interopkit packages: errors, argument checks, bounded HTTP service calls, plain request and
response types, a signing port and OAuth 2.0 clients.

It has their errors, the checks of their arguments and the findings of their readers, a clock and a random source, the call to a
service over HTTP with a deadline, a size limit and no redirects, requests and answers as plain data, the signing port, and
OAuth 2.0 clients. Most users install the package of a standard, such as
[`@interopkit/tool-integration`](https://interopkit.wakan.dev/_interopkit/tool-integration/) or
[`@interopkit/competency-frameworks`](https://interopkit.wakan.dev/_interopkit/competency-frameworks/), which depends on it.

```bash
npm install @interopkit/core
```

## Quick start

```ts
import { callService, DEFAULT_TIMEOUT_MS } from "@interopkit/core";

const fetch = async () => new Response('{"keys":[]}');
const body = await callService(
  { fetch, timeoutMs: DEFAULT_TIMEOUT_MS },
  "The key set at https://platform.example/jwks",
  "https://platform.example/jwks",
  { method: "GET", headers: { accept: "application/json" } },
);
// => '{"keys":[]}'
```

A call that fails rejects with a `ServiceError` whose `status` is the HTTP status, or 0 when the service did not answer.

## Architecture

```mermaid
flowchart BT
  core["@interopkit/core<br/>errors, checks, clock, service calls,<br/>http, signer, oauth"]
  standards["The package of each standard:<br/>tool-integration, learning-analytics,<br/>competency-frameworks and the others"] --> core
  host["Your application"] --> standards
  host -.->|"service calls, errors, Clock,<br/>HttpRequest, HttpResponse, Signer"| core
```

## API

| Subpath                   | Exports                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@interopkit/core`        | `InteropkitError`, the base class; `DataError`, for invalid input; `LimitError`, for input over a limit, with `limit` and `maximum`, which a host answers with 413; `ServiceError`, for a service that fails, with `status` and `body`; each takes `ErrorOptions` with the `cause`                                                                                                                                                                                                                                                  |
|                           | `Clock`, `SYSTEM_CLOCK`, `readClock`, `checkClock`; `Random`, `SYSTEM_RANDOM`; `Signer`, `createCryptoKeySigner`, `signCompactJws`                                                                                                                                                                                                                                                       |
|                           | `CallOptions`, the `signal` that ends a caller's wait, `raceAbort`, `createKeyedCache` with `KeyedCache` and `KeyedCacheOptions` for shared loads, `createJwksCache` with `JwksCache` and `JwksCacheOptions` for the JWK Sets of other parties, and `callPort` with `PortOutcome`, which turns the failure of a port into a value; `Fetch`, `ServiceCall`, `ServiceInit`, `ServiceResponse`, `RequestOptions`, `HttpMethod`, `requestService`, `callService`, `DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_BYTES`; `requestWithCredential` with `CredentialServiceCall`, and `clientOptionsEntries`, for a client whose requests carry a token                                                                                                                                        |
|                           | `readTotalCount`, `hasNextLink`, `hasNextPage`, `readRetryAfterSeconds`, `findLinkTarget`: the paging and retry headers of an answer; `readAnswerJson`, `ReadAnswerJsonOptions`, `readAnswer`, `readStatusDetail`, `readStatusInfo`, `StatusDetail`, `StatusInfo`, `StatusCodeMinor`, `StatusCodeMinorField`: the JSON, the data and the status of an answer; `ServiceErrorOptions`, `CryptoKeySignerOptions` |
| `@interopkit/core/oauth`  | `requestClientCredentialsToken`, `startAuthorization`, `exchangeCode`, `refreshAccessToken`, `revokeToken`, `registerClient`, `createTokenCache`, `TokenCacheOptions`, `GRANT_TYPES`, `GrantType`; `AuthorizationServer`, `OAuthClient`, `ClientAuthentication`, `OAuthCallOptions`, `AccessToken`, `PendingAuthorization`, `AuthorizationRequestParameters`, `ClientMetadata`, `RegisteredClient`                                                                             |
| `@interopkit/core/http`   | `HttpRequest`, `HttpResponse`, `checkHttpRequest`, `basePathSchema`; `readText`, `readJson`, `ReadJsonOptions`, `readQuery`, `readForm`, `ReadFormOptions`, `readBearerToken`; `buildJsonResponse`; `negotiate`; `readOffsetPage`, `buildPageLinks`, `OffsetPage`, `PageSizes`, `ListExtent`; `buildStatusInfoResponse`, `StatusInfoOptions`; `AccessDecision`, `AccessRefusal`, `AccessRefusalReason`, `ACCESS_REFUSAL_STATUSES`, `readAccessDecision`, `ReadAccessDecisionOptions`                                                                                                                                                                                                                                                        |
| `@interopkit/core/checks` | Checks of one value: `describe`, `isRecord`, `checkRecord`, `checkArray`, `checkFunction`, `checkProperties`, `checkString`, `checkNonEmptyString`, `checkHttpsUrl`, `checkRemoteUrl`, `checkBaseUrl`, `checkNonNegativeInteger`, `checkPositiveInteger`, `checkAbortSignal`, `readCallOptions`                                                                                                                                             |
|                           | Schemas: `parseWith`, `formatIssuePath`, `describeIssue`, `buildFindings`, `buildIssues`, `Finding`, `guardSchema`, `looseRecord`, `openRecord`, `strictRecord`, `jsonObjectSchema`, `jsonValueSchema`, `mapSchema`, `methodsSchema`, `finiteSchema`, `httpsUrlSchema`, `remoteUrlSchema`, `nonEmptyStringSchema`, `nonNegativeIntegerSchema`, `positiveIntegerSchema`, `positiveSchema`, `uuidSchema`, `dateSchema`, `dateTimeSchema`, `absoluteUriSchema` |
|                           | Formats: `isDate`, `parseDateTime`, `formatDateTime`, `isDateTime`, `isUuid`, `isAbsoluteUri`, `isLanguageTag`, `languageTagSchema`. JSON: `copyJson`, `JsonValue`, `JsonObject`, `JsonValueCopy`, `JsonObjectCopy`, `MAX_JSON_DEPTH`, `MAX_JSON_TOKENS`, `nestsDeeperThan`, `hasMoreTokensThan`, `findExceededJsonLimit`, `parseJsonText`, `JsonTextRefusals`, `endOfJsonString`; `Schema` |
|                           | Findings: `Finding`, `Issue`, `buildFindings`, `describeRefusal`, `createIssueSink`, `IssueSink`, `safeParseBounded`, `BoundedParse`, `DEFAULT_MAX_FINDINGS` |

## Supported

It runs in Node.js, browsers, Deno, Bun and edge runtimes such as Cloudflare Workers: it uses web standards only, reads no
environment variable, writes no log, and calls the network only through the `fetch` that the caller passes. Its dependencies are
[valibot](https://valibot.dev), [oauth4webapi](https://github.com/panva/oauth4webapi) and [jose](https://github.com/panva/jose).

## Documentation

[Choosing](https://interopkit.wakan.dev/_interopkit/core/choosing/) says when the package fits, when another library fits better,
and what each has that the package lacks.

Each entry point bundled alone, minified with its dependencies, takes after gzip: `@interopkit/core` 11.7 KB with valibot and jose,
`/checks` 7.5 KB and `/http` 7.7 KB, each with valibot, and `/oauth` 15.3 KB with oauth4webapi; `test/size.test.ts` holds each to
its budget and to the modules it lists. [Performance](https://interopkit.wakan.dev/_interopkit/core/performance/)
gives the speed of the hot paths, the sizes and the peak memory of the readers. The guides say more: [service calls](https://interopkit.wakan.dev/_interopkit/core/service/),
[requests and answers](https://interopkit.wakan.dev/_interopkit/core/http/),
[signing](https://interopkit.wakan.dev/_interopkit/core/signer/),
[OAuth clients](https://interopkit.wakan.dev/_interopkit/core/oauth/),
[signals](https://interopkit.wakan.dev/_interopkit/core/signals/),
[checks](https://interopkit.wakan.dev/_interopkit/core/checks/),
[errors](https://interopkit.wakan.dev/_interopkit/core/errors/),
[clock](https://interopkit.wakan.dev/_interopkit/core/clock/) and
[random](https://interopkit.wakan.dev/_interopkit/core/random/).

## License

[Apache-2.0](https://github.com/interopkit/interopkit/blob/main/packages/core/LICENSE). Copyright Fariz Wakan. See [NOTICE](https://github.com/interopkit/interopkit/blob/main/packages/core/NOTICE).
