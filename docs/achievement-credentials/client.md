# The client of the Open Badges and CLR APIs

`@interopkit/achievement-credentials/client` talks to a resource server that implements the Open Badges API (OB 6) or the CLR
Standard API (CLR 5): it finds the server's OAuth 2.0 endpoints, lists a user's credentials page by page, adds or replaces a
credential, and reads or replaces the user's profile. It makes its requests through the `fetch` that the host passes in, reads
every answer with the readers of the package, and takes its access tokens from a function of the host, which
`@interopkit/core/oauth` can supply.

```mermaid
flowchart LR
  host["Your application"] -->|"baseUrl, api"| discover["discoverService<br/>GET /discovery, no token"]
  discover -->|"tokenUrl, authorizationUrl,<br/>registrationUrl, scopes"| oauth["@interopkit/core/oauth<br/>register, authorize with PKCE,<br/>refresh, revoke"]
  oauth -->|"createTokenCache"| token["token()"]
  host --> client["createCredentialsClient"]
  token --> client
  client --> call["requestService of core<br/>HTTPS, no redirect, deadline, size limit"]
  call --> server[("Resource server")]
  server -->|"200, 201"| read["readCredential, readEntity<br/>valid or DataError"]
  server -->|"304"| unchanged["unchanged"]
  server -->|"404 of the profile"| none["undefined"]
  server -->|"another status"| error["ServiceError<br/>status, headers, body"]
  error -->|"readStatusInfo"| detail["imsx_StatusInfo<br/>and Retry-After"]
```

| Call                                      | Request                                       | Gives                                                                |
| ----------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| `discoverService(baseUrl, api, options)`  | `GET {base}/ims/{ob/v3p0, clr/v2p0}/discovery` | `ServiceDescription`: the OAuth endpoints, scopes and policies        |
| `client.listCredentials(options)`         | `GET .../credentials?limit&offset&since`      | An async iterable of credentials (objects) and compact JWS (text)     |
| `client.upsertCredential(credential, o)`  | `POST .../credentials`                        | `"created"` (201), `"replaced"` (200) or `"unchanged"` (304)          |
| `client.getProfile(options)`              | `GET .../profile`                             | `Profile`, or `undefined` for 404                                     |
| `client.putProfile(profile, options)`     | `PUT .../profile`                             | The `Profile` that the server answers with (200)                      |
| `readStatusInfo(error)`                   |                                               | The `imsx_StatusInfo` and the seconds of `Retry-After` of a refusal   |

`api` is `"badges"` for `/ims/ob/v3p0` and `"clr"` for `/ims/clr/v2p0`. The caller's `options` is `{ signal }`, which ends that
caller's wait.

## Quick start

```ts
import { createCredentialsClient } from "@interopkit/achievement-credentials/client";

const credential = {
  "@context": ["https://www.w3.org/ns/credentials/v2", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"],
  id: "https://example.edu/credentials/3732",
  type: ["VerifiableCredential", "OpenBadgeCredential"],
  issuer: { id: "https://example.edu/issuers/565049", type: ["Profile"], name: "Example University" },
  validFrom: "2024-06-13T18:46:03Z",
  credentialSubject: {
    id: "did:example:learner",
    type: ["AchievementSubject"],
    achievement: {
      id: "https://example.edu/achievements/1",
      type: ["Achievement"],
      name: "Fractions",
      description: "Understands fractions as numbers.",
      criteria: { narrative: "Pass the final assessment." },
    },
  },
};
const client = createCredentialsClient({
  api: "badges",
  baseUrl: "https://badges.example.org",
  fetch: async () => Response.json({ credential: [credential] }, { headers: { "X-Total-Count": "1" } }),
  token: async () => "863DF0B10F5D432EB2933C2A37CD3135A7BB7B07A68F65D92",
});
const found = [];
for await (const each of client.listCredentials()) found.push(typeof each);
found; // => ["object"]
```

In a host, `fetch` is `globalThis.fetch`. A call to the server that is not a GET:

```ts
import { createCredentialsClient } from "@interopkit/achievement-credentials/client";

const client = createCredentialsClient({
  api: "badges",
  baseUrl: "https://badges.example.org",
  fetch: async () => new Response(null, { status: 304 }),
  token: async () => "863DF0B10F5D432EB2933C2A37CD3135A7BB7B07A68F65D92",
});
const jws = "aGVhZGVy.cGF5bG9hZA.c2ln";
await client.upsertCredential(jws); // => "unchanged"
```

The tokens come from the authorization server that the service description names. `discoverService` finds its endpoints, and the
OAuth clients of `@interopkit/core/oauth` register, run the authorization code flow with PKCE, refresh and revoke:

```ts
import { discoverService } from "@interopkit/achievement-credentials/client";
import { createTokenCache } from "@interopkit/core/oauth";

const description = {
  openapi: "3.0.1",
  info: {
    title: "Example Provider",
    version: "1.0",
    termsOfService: "https://auth.example.org/terms",
    "x-imssf-privacyPolicyUrl": "https://auth.example.org/privacy",
  },
  components: {
    securitySchemes: {
      OAuth2ACG: {
        type: "oauth2",
        "x-imssf-registrationUrl": "https://auth.example.org/registration",
        flows: {
          authorizationCode: {
            authorizationUrl: "https://auth.example.org/authorize",
            tokenUrl: "https://auth.example.org/token",
            scopes: { "https://purl.imsglobal.org/spec/ob/v3p0/scope/credential.readonly": "Read credentials" },
          },
        },
      },
    },
  },
};
const service = await discoverService("https://badges.example.org", "badges", { fetch: async () => Response.json(description) });
service.tokenUrl; // => "https://auth.example.org/token"
service.scopes; // => ["https://purl.imsglobal.org/spec/ob/v3p0/scope/credential.readonly"]
const server = {
  tokenEndpoint: service.tokenUrl,
  authorizationEndpoint: service.authorizationUrl,
  registrationEndpoint: service.registrationUrl,
};
const obtain = async () => ({ accessToken: "at-1", expiresAt: 1_700_003_600_000, scopes: service.scopes });
const token = createTokenCache(obtain, { clock: { now: () => 1_700_000_000_000 } });
await token(); // => "at-1"
server.registrationEndpoint; // => "https://auth.example.org/registration"
```

Registration at an Open Badges server (OB 7.1.1.2) asks for the grants `authorization_code` and `refresh_token`, which is what
`registerClient` asks for unless `grantTypes` says otherwise, and requires a logo, terms, a privacy policy and a software id and
version beside the name and the redirect addresses: pass `logoUri`, `tosUri`, `policyUri`, `softwareId` and `softwareVersion`.
`server`, a registered client and the user's consent give the `obtain` function with `registerClient`, `startAuthorization`,
`exchangeCode` and `refreshAccessToken` (see [the OAuth guide](../core/oauth.md)); `token` is then the `token` option of the client.

## Options

| Option      | Applies to                                | Meaning                                                                                                   | Default    |
| ----------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| `api`       | the client                                | `"badges"` or `"clr"`                                                                                     | Required   |
| `baseUrl`   | the client, `discoverService`             | The server before the path of the API: an absolute `https` URL without credentials, query or fragment      | Required   |
| `fetch`     | the client, `discoverService`             | The `Fetch` that makes the requests                                                                        | Required   |
| `token`     | the client                                | Returns the access token before every request; it receives the `signal` of the call                       | Required   |
| `timeoutMs` | the client, `discoverService`             | The most time of one request, from the request to the last byte of the answer                              | 10,000     |
| `maxBytes`  | the client                                | The most bytes of one answer                                                                               | 16,777,216 |
| `maxTokens` | the client                                | The most tokens of JSON in one answer, counted before it is parsed: each bracket, brace, colon and comma, each string, each number and each `true`, `false` and `null` | 1,000,000  |
| `pageSize`  | the client                                | The `limit` of a request for credentials, and the most credentials that a page may hold                    | 100        |
| `signal`    | the client, `discoverService`, each call  | Ends the wait; the signal of the configuration and the signal of a call both count                         | none       |
| `since`     | `listCredentials`                         | A date and time with an offset: only credentials issued after it                                           | none       |

A base that already ends with the path of an API (`/ims/ob/v3p0`) is refused: the client adds the path itself.

## Listing credentials

Each request asks for `pageSize` credentials from the next offset. The iteration stops when the server says that no page follows,
in this order: `X-Total-Count` when it is a count (the iteration goes on while the offset is below it), else the `Link` header
(it goes on while a value has the relation `next`), else the size of the page (it goes on while the page is as long as the
request). It stops too at an empty page and at a page that holds only credentials already seen, so a server that ignores
`offset` cannot hold it in a loop. A collection that changes between pages may repeat or skip a credential; a credential seen
twice is given once, by its `id` (a compact JWS by its text). The iteration keeps the SHA-256 of each `id` and compact JWS that it
has given, so what it holds grows with the number of credentials and not with their size. The client builds each request from
`baseUrl` and never fetches an address of a `Link` header, which could lead anywhere.

A credential comes as the model has it (`readCredential` of the kind the API exchanges), and a credential signed as a VC-JWT as
its compact JWS, in the order of the page: the credentials first, then the compact JWS. Nothing has verified them.

## Errors

| Case                                                                                           | Result                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| The configuration, an option, a credential or a profile to send is not valid                    | `DataError` that names the option and what it must be, before any request                                                |
| `token` returns something that is not printable characters without a space                      | `DataError`, and no request: a token could otherwise end the header                                                      |
| `token` rejects                                                                                | Its error, unchanged, and no request is made                                                                             |
| The server answers 201 or 200 to an upsert                                                      | `"created"` or `"replaced"`; the body, which repeats the credential, is not read                                         |
| The server answers 304 to an upsert                                                             | `"unchanged"`                                                                                                            |
| The server answers 404 to `getProfile`                                                          | `undefined`                                                                                                              |
| Another status: 202 or 304 of `putProfile`, 400, 401, 403, 404, 405, 429, 500 or any other      | `ServiceError` with `status`, `headers` and `body`; read it with `readStatusInfo`                                        |
| The server did not answer within `timeoutMs`, or `fetch` rejected                               | `ServiceError` with status 0                                                                                             |
| The answer is larger than `maxBytes`                                                            | `ServiceError` with the status of the answer, naming the limit; the body is cancelled                                    |
| The answer is a redirect                                                                        | `ServiceError`: the client follows none. Use the address that the server redirects to as `baseUrl`                       |
| The answer has more tokens of JSON than `maxTokens`                                             | `DataError`: `The Open Badges API at <url> answered with a body of more than N tokens of JSON, above the limit of the option maxTokens.` Raise `maxTokens` for a server that sends larger pages |
| The answer is not UTF-8 or not JSON, nests more than 64 levels, or is not valid Open Badges or CLR | `DataError`: `The Open Badges API at <url> answered with data that is not valid Open Badges: <the first fault>`       |
| A page holds more credentials than `pageSize`, or a credential or a profile is too long          | `DataError`, before the readers see it                                                                                   |
| The service description lacks the authorization code flow, or has an address that is not `https` | `DataError` that names the path of the first fault                                                                      |
| The `signal` of the call or the configuration aborts                                            | The call rejects with `signal.reason`                                                                                    |

A server that accepts a profile and has not applied it answers `putProfile` with 202 and an `imsx_StatusInfo`, which holds no
profile: that is a `ServiceError` with status 202, and the profile is visible later through `getProfile`.

`readStatusInfo(error)` returns `{ info, retryAfterSeconds }`. `info` is the `imsx_StatusInfo` in the body, left out when the body
is not one, as a proxy's page is not. `retryAfterSeconds` is `Retry-After` when it is a number of seconds; the form with a date
needs a clock and stays in `error.headers["retry-after"]`.

### Retrying

The client retries nothing. OB 6.5 and CLR 5.5 say what a client should do when a request fails with a status other than 2xx:

| The answer                      | What the host does                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Retry-After` is present        | Wait that long and ask again                                                                                               |
| `Retry-After` is absent         | Ask again after 30 minutes, twice; then tell the user, who may need to authorize again or may ask again later              |
| 401                             | The token was refused: get a new one (refresh, or authorize again) and ask again                                           |

A repeat is safe for every call: a GET changes nothing, `upsertCredential` compares credentials as OB 10 asks, and `putProfile`
replaces the whole profile.

### Failure paths

| What                 | Fails                                                     | Hangs                              | Called again                                                                                                          | May call back |
| -------------------- | --------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------- |
| `fetch`              | `ServiceError`; 404 of the profile gives `undefined`      | `timeoutMs`, then status 0         | Safe. A collection that changes between pages may repeat or skip a credential; repeats are dropped                    | Nothing       |
| `token`              | Its error reaches the caller; no request is made          | The caller's `signal` is passed on, and the wait ends when it aborts, whether the function stops or not | Called before every request, so it may return a fresh token                                                           | Nothing       |
| The answer too large | `ServiceError` naming the limit                           | As `fetch`                         | The same answer until `maxBytes` grows                                                                                | Nothing       |

## Limits

| Limit                                              | Value      | Refused with                                                                      |
| -------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `timeoutMs`                                        | 10,000 ms  | `ServiceError`, status 0                                                          |
| `maxBytes` of an answer                            | 16,777,216 | `ServiceError`                                                                    |
| Bytes of a service description                     | 1,048,576  | `ServiceError`                                                                    |
| `pageSize`                                         | 100        | `DataError` when a page holds more                                                |
| Levels of JSON in an answer                        | 64         | `DataError`, before the text is parsed                                            |
| `maxTokens` of an answer                           | 1,000,000  | `DataError`, before the text is parsed                                            |
| Redirects                                          | 0          | `ServiceError`                                                                    |

`JSON.parse` takes about forty times the text of small objects in memory, so the client counts the tokens of an answer before it
parses it. Measured on Node.js 26, an answer of 16 MiB of empty objects is refused for its tokens in 30 ms and 84 MB above the
process, and `readCredential` of a credential of 1 MiB that is a list of empty objects stops at `maxFindings` and takes 139 MB,
most of it the parse and the copy of the value. Lower `maxBytes` for a server that you do not trust: the cost grows with it, and
a page of credentials is a few kilobytes each.

## Not included

| Not included                                     | Why                                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Retries and backing off                          | The host knows its budget; `readStatusInfo` gives `Retry-After`                                                      |
| Registration, tokens and revocation               | `@interopkit/core/oauth` does them for any API; `discoverService` supplies the endpoints                              |
| The revocation endpoint                          | The specifications name no property of the service description for it: the host knows it from the server's own documents |
| A cache of the service description                | The host keeps it as long as `Cache-Control` and `Expires` allow (OB 7.1.1.1)                                         |
| Fetching the address of a `Link` header           | An address from a server could lead anywhere; the client builds each request from `baseUrl`                           |
| Verifying the credentials                        | `verifyCredential` does it                                                                                           |
| OAuth 2.0 client credentials                     | The specifications leave it to a later version (OB 6, note)                                                           |

## Differences from the references

| Case                                     | The specification                                                                                          | The client                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The example of `getCredentials`          | Writes `compactJwsStrings` and `GET /ims/ob/v3p0/credentials=2&offset=0`                                    | Reads `compactJwsString`, as the schema writes it, and asks `credentials?limit=2&offset=0`         |
| The example of the service description   | Puts the name, the privacy policy and the terms in the security scheme, and gives addresses without a scheme | Reads `info.title`, `info.termsOfService` and `x-imssf-privacyPolicyUrl` of `info`, as the schema writes them, and requires `https` addresses |
| A page with more than `limit` credentials | `limit` is the most to return                                                                              | A `DataError`                                                                                      |
| 304 for `upsertCredential`               | Lists `imsx_StatusInfo` as its body                                                                         | `"unchanged"`: a 304 has no body                                                                   |
| 202 and 304 for `putProfile`             | Answers with an `imsx_StatusInfo`                                                                           | A `ServiceError`: there is no profile to return                                                    |
| The request content types                | `application/vc+ld+json` or `application/json` for a credential, `text/plain` for a compact JWS            | `application/json` and `text/plain`                                                                |
