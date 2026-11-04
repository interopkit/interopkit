# LTI tool role

`@interopkit/tool-integration/tool` lets a learning platform launch your application as an LTI 1.3 tool. It runs on a
server or an edge runtime, with [jose](https://github.com/panva/jose) to verify the platform's tokens, a `Signer` of
[`@interopkit/core`](../core/signer.md) for the tool's own, and the OAuth client of [`@interopkit/core/oauth`](../core/oauth.md)
for its access tokens. LTI 1.0 to 1.2
launches (OAuth 1.0a, retired on 2022-06-30) are refused. The root subpath, `@interopkit/tool-integration`, holds what both
roles share: `LtiError` and `createJwksCache`. The request and answer types are in
[`@interopkit/core/http`](../core/http.md).

```mermaid
sequenceDiagram
  participant P as Platform
  participant B as Browser
  participant T as Tool<br/>(the host's routes)
  P->>B: send to the tool's login URL
  B->>T: login (iss, login_hint, target_link_uri, lti_deployment_id, ...)
  T->>T: handleLogin: state, nonce, deployment and target into the LtiStore
  T-->>B: redirect to the authentication request, or the storage page
  B->>P: authentication request
  P-->>B: form_post of the id_token to the redirect URI
  B->>T: POST id_token and state
  P->>T: GET the tool's key set (serveToolJwks), when it checks a tool JWT
  T->>T: handleLaunch: signature, claims, nonce, deployment and target; delete the login
  T-->>B: the launch
  opt Deep Linking request
    T->>P: buildDeepLinkingResponse: a page that posts the signed JWT to the return URL
  end
  opt Grade and roster services
    T->>P: createServiceClient: a cached access token, then the line item, the score, the results, the members, the groups
  end
```

| Function                                      | Does                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `handleLogin(request, options)`                  | Answers the platform's third-party initiated login with the authentication request            |
| `handleLaunch(request, options)`                 | Validates the `id_token` and returns the launch, or the verification page of the storage path |
| `serveToolJwks(request, keys, options)`       | Answers the request for the tool's key set: the public keys of its `KeySet`                   |
| `buildDeepLinkingResponse(launch, response, options)` | Checks the items, signs the response to a Deep Linking request and returns the page that posts it ([Deep Linking](deep-linking.md)) |
| `buildStartAssessmentPage(launch, input, options)` | Signs the Start Assessment message of a proctored attempt and returns the page that posts it ([proctoring](proctoring.md)) |
| `createServiceClient(deployment, options)`    | Returns the client of the services of a platform: grades ([grade services](grades.md)), members, groups and preferences ([roster services](roster.md)), the control of an attempt ([proctoring](proctoring.md)), and the tool's registration ([registration](registration.md)) |
| `readRegistrationInitiation`, `discoverPlatform`, `registerTool`, `buildPlatformRegistration`, `buildRegistrationClosePage` | The steps of Dynamic Registration ([registration](registration.md)) |
| `advanceScoreTimestamp(lastSent, now)`        | Returns a timestamp of a score strictly later than the last one sent                          |
| `createJwksCache(options)`                    | Creates the cache of the platforms' key sets that `handleLaunch` verifies signatures with        |

The handlers take an `HttpRequest` and return an `HttpResponse` of [`@interopkit/core/http`](../core/http.md), plain objects that a host builds from any web framework. The
host owns the routes, the sessions, the database and the keys. The [example](../../examples/tool-integration/README.md) runs a tool
and a platform against each other in one process.

## Sources

| Specification                                                                                                                                                                                                  | Used for                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [LTI 1.3 Core](https://www.imsglobal.org/spec/lti/v1p3)                                                                                                                                                        | Login parameters, launch claims, token endpoint                       |
| [LTI Security Framework 1.1](https://www.imsglobal.org/spec/security/v1p1)                                                                                                                                     | Authentication request, `id_token` validation, key sets, assertions   |
| [LTI Deep Linking 2.0](https://www.imsglobal.org/spec/lti-dl/v2p0)                                                                                                                                             | Deep Linking request and response                                     |
| [LTI Assignment and Grade Services 2.0](https://www.imsglobal.org/spec/lti-ags/v2p0)                                                                                                                           | The `endpoint` claim of a launch, the line item and the score service |
| [LTI Client Side OIDC 0.1](https://www.imsglobal.org/spec/lti-cs-oidc/v0p1)                                                                                                                                    | `state` and `nonce` in the platform's browser storage                 |
| [LTI Client Side postMessages 0.1](https://www.imsglobal.org/spec/lti-cs-pm/v0p1)                                                                                                                              | The capabilities request, and the frame that receives the messages    |
| [LTI 1.3 Migration Guide](https://standards.1edtech.org/lti/guides/migration/migration-guide)                                                                                                                  | The `lti1p1` claim and its `oauth_consumer_key_sign`                  |
| [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749), [RFC 7515](https://www.rfc-editor.org/rfc/rfc7515), [RFC 7518](https://www.rfc-editor.org/rfc/rfc7518), [RFC 7523](https://www.rfc-editor.org/rfc/rfc7523) | OAuth 2.0, JWS, RS256, the JWT assertion                              |

## Example

A host builds the registration of each platform, the store of logins and the options. It generates its key in the sample; a real
host keeps the key that the platform's administrator registered. The routes of the host turn the request of its web framework into
an `HttpRequest` (with the header names in lower case, as `Object.fromEntries(request.headers)` gives them, and the body as
bytes, as `new Uint8Array(await request.arrayBuffer())` gives it) and the `HttpResponse` back into a response.

```ts
import { createCryptoKeySigner } from "@interopkit/core";
import { createJwksCache } from "@interopkit/tool-integration";
import { handleLogin } from "@interopkit/tool-integration/tool";

const keys = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  false,
  ["sign"],
);
const registration = {
  issuer: "https://lms.example.edu",
  clientId: "962fa4d8-bcbf-49a0-94b2-2de05ad274af",
  deploymentIds: ["07940580-b309-415e-a37c-914d387c1150"],
  authenticationUrl: "https://lms.example.edu/auth",
  jwksUrl: "https://lms.example.edu/jwks",
  accessTokenUrl: "https://lms.example.edu/token",
  redirectUri: "https://tool.example.com/lti/launch",
  signer: createCryptoKeySigner(keys.privateKey, { algorithm: "RS256", keyId: "tool-1" }),
};

const clock = { now: () => Date.now() };
const logins = new Map();
const store = {
  put: async (state, record) => void logins.set(state, record),
  get: async (state) => logins.get(state),
  delete: async (state) => logins.delete(state),
};
const options = {
  registration: async (issuer, clientId) =>
    issuer === registration.issuer && (clientId === undefined || clientId === registration.clientId)
      ? registration
      : undefined,
  clock,
  store,
  jwks: createJwksCache({ fetch, clock }),
};

// The route of the tool's login URL, for a platform that starts the login with a GET.
const login = new URL("https://tool.example.com/lti/login");
login.search = new URLSearchParams({
  iss: registration.issuer,
  login_hint: "user-1",
  target_link_uri: "https://tool.example.com/lti/launch",
  client_id: registration.clientId,
}).toString();
const response = await handleLogin({ method: "GET", url: login.href, headers: {}, body: new Uint8Array() }, options);
response.status; // => 302
const authentication = new URL(response.headers.location);
authentication.origin + authentication.pathname; // => "https://lms.example.edu/auth"
authentication.searchParams.get("scope"); // => "openid"
logins.size; // => 1
```

The route of the redirect URI passes the platform's post and, on the storage path, the verification page's post to `handleLaunch`.
It returns a launch, or a response that the host sends.

## Registrations

`options.registration(issuer, clientId, callOptions)` returns the `PlatformRegistration` of a platform, or `undefined`. `clientId` is
`undefined` unless the platform names it (`client_id`, LTI 1.3 Core section 4.1.3). The returned registration is checked on every
call and must match the issuer and the client.

| Property            | Meaning                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `issuer`            | The `iss` of the platform: an `https` URL without query or fragment                                          |
| `clientId`          | The OAuth 2.0 client identifier that the platform gave the tool                                              |
| `deploymentIds`     | The deployments that the tool accepts; the `deployment_id` of a launch must be one of them                   |
| `authenticationUrl` | The platform's OIDC authentication endpoint                                                                  |
| `jwksUrl`           | The platform's key set                                                                                       |
| `accessTokenUrl`    | The platform's token endpoint, also the `aud` of the client assertion unless `audience` is set               |
| `audience`          | Optional: the `aud` of the client assertion, for a platform that wants a value other than its token endpoint |
| `redirectUri`       | The tool's launch URL. The route of `handleLaunch` must answer it                                               |
| `signer`            | Signs the tool's client assertions and Deep Linking responses: one of RS256, RS384, RS512, ES256, ES384 and ES512, with a `keyId` that is the `kid` of its public key in the tool's key set. A key in a KMS or an HSM works |
| `algorithms`        | Optional: the algorithms accepted on the platform's tokens. Default: all six of Security Framework section 7.2 |
| `trustedAudiences`  | Optional: the parties besides the client that an `id_token`'s `aud` may name (Security Framework section 5.1.3). Default: none |
| `serviceOrigins`    | Optional: the origins, such as `https://lms.example.edu`, that the service URLs of a launch may have. When given, a URL on another origin is refused, and one on a listed origin passes whatever its host. Default: any URL that `checkRemoteUrl` of [`@interopkit/core/checks`](../core/checks.md) accepts |

Every URL is `https` (LTI 1.3 Core section 3.5). The platform reads the tool's public key under the signer's `keyId`, from the
key set that `serveToolJwks` answers or from its own registration of the tool.

## The login store

`LtiStore` keeps the logins in progress, by `state`. `handleLogin` calls `put`, `handleLaunch` calls `get` and then `delete`.

| Method                        | Contract                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `put(state, record, options)` | Saves the `LoginRecord`: `nonce`, `issuer`, `clientId`, `deploymentId` when the initiation named one, `targetLinkUri`, `storageTarget` and `expiresAt` |
| `get(state, options)`         | Returns the record, or `undefined`                                                                |
| `delete(state, options)`      | Deletes the record and returns whether there was one. Of two concurrent calls, one returns `true` |

A login is valid for 600 seconds (`expiresAt`). The host may delete expired records. `delete` must be atomic: it is what makes
a login complete once.

## Login and launch

The platform sends the browser to the login URL (Security Framework section 5.1.1.1). `handleLogin` creates a `state` and a `nonce`
of 160 random bits each, saves them in the store and answers with the authentication request (section 5.1.1.2): `scope=openid`,
`response_type=id_token`, `client_id`, `redirect_uri`, `login_hint`, `state`, `response_mode=form_post`, `nonce`,
`prompt=none`, and `lti_message_hint` unchanged when the platform sent it. The initiation may be a GET or a form POST of at
most 65,536 bytes. The login keeps the initiation's `target_link_uri`, an `https` URL, and its `lti_deployment_id` when there is
one, which must be a deployment of the registration (`deployment-unknown`): the launch must carry both (LTI 1.3 Core sections
4.1.2 and 5.3.4).

The tool must tie the launch to the browser that logged in, or an attacker could make a victim's browser launch with the
attacker's token (login CSRF, Security Framework 1.1 section 7.4.1). Every answer of `handleLogin` sets the state cookie,
`__Host-lti_state_<state>=<state>; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=None`, and a launch whose post carries it is
bound by it. When the platform names a storage frame, the tool also stores the values in the platform, for a browser that does
not keep the cookie.

| Path    | When                                       | The answer of `handleLogin`                                                                   | What binds the browser                                                                                                     |
| ------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Cookie  | The initiation has no `lti_storage_target` | A 302 to the authentication request, with the cookie                                       | The cookie, which the launch compares with `state`                                                                         |
| Storage | The initiation has `lti_storage_target`    | A page that stores `state` and `nonce` in the platform with `lti.put_data`, then redirects; with the cookie | The cookie when the browser kept it; else the platform's storage, which the verification page reads with `lti.get_data` at the launch |

The storage path works in an iframe whose browser blocks third-party cookies, and in a tab of its own, which keeps the
first-party cookie. The `__Host-` prefix keeps a sibling subdomain from setting the cookie, and the name holds the `state`, so
that several launches in one browser do not collide.

### The storage path

LTI Client Side OIDC 0.1 sections 2.3 to 2.7 and section 3 define the messages. The page first asks the window that framed or
opened it for its capabilities (`lti.capabilities`, Client Side postMessages 0.1 section 4.1), to the wildcard origin as section
4.1.2 asks, and waits at most 100 milliseconds for the answer to its own request. A frame that the answer names for
`lti.put_data` receives the storage messages; without an answer, or without a frame for the subject, the frame named by
`lti_storage_target` does (`_parent` for the parent). The page stores `state_<state>` and `nonce_<nonce>` there, waits for
`lti.put_data.response`, and navigates to the authentication request. A message counts only when it comes from the origin of `authenticationUrl`, has the subject
`<subject>.response` and answers the page's `message_id`. If the platform answers with an error, names no such frame or is
silent for 10 seconds, the page shows a message and stops. A page in a window that has neither a parent nor an opener, such as a
tab that the platform opened with `noopener`, has no frame of the platform to store in: it navigates to the authentication
request at once, and the cookie binds its launch.

At the launch, the platform posts the `id_token` to the redirect URI. When the post carries the state cookie, `handleLaunch` completes
the launch. When the browser did not keep it, as a frame of another site does not, `handleLaunch` answers with the verification page: it asks
for the capabilities in the same way, fetches `state_<state>` and `nonce_<nonce>` with `lti.get_data` and submits the form with `id_token`, `state`, `stored_state`
and `stored_nonce` to the same URL. That second request completes the launch, so the host routes both to `handleLaunch`. It must
pass the `origin` header, because `handleLaunch` accepts the second request only from the origin of the redirect URI: without
cookies, nothing else stops a cross-site form from posting a token of the attacker's with values of its own.

The scripts of the two pages use only features that Chromium 111, Firefox 115 and Safari 16.4 have, and later versions. Both pages carry a CSP that allows their one script by hash (`default-src 'none'; script-src 'sha256-...'; base-uri 'none';
form-action 'self'`), `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and every value in them is
HTML-encoded. The storage page sends no referrer; the verification page sends one to its own origin alone
(`Referrer-Policy: same-origin`), since under `no-referrer` a browser posts its form with `Origin: null`, which `handleLaunch` refuses. `handleLaunch` echoes the `id_token` of the platform's post into the verification page before it verifies it, and
only for a `state` that the tool issued.

### What `handleLaunch` checks

A request that is not a POST of a form with `id_token` and `state` is a `DataError`, and a form of more than `maxFormBytes`,
65,536 by default, measured before it is decoded, a `LimitError` of `@interopkit/core` with `limit` `maxFormBytes`. Then, in
this order, a failure throws `LtiError` with the reason in the table. The login stays in the store until the launch succeeds or
expires.

| Check                                                                                                                           | Reason                                            |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| The form has no `oauth_consumer_key`, which an LTI 1.0 to 1.2 launch carries                                                    | `legacy-launch`                                   |
| The form has no `error`: the platform's authentication error response (Security Framework section 5.1.1.5), whose `error` and `error_description` the message quotes | `platform-error` |
| `state` names a login in the store, made of base64url characters                                                                | `state-unknown`                                   |
| The login has not expired                                                                                                       | `state-expired`                                   |
| The platform is still registered                                                                                                | `platform-unknown`                                |
| The state cookie equals `state`; without it, a login without `lti_storage_target` is refused                                   | `state-cookie`                                    |
| Without the cookie, on the storage path: the second post comes from the redirect URI's origin, with `stored_state` and `stored_nonce` equal to the login's | `origin-mismatch`, `storage-mismatch` |
| The token has three canonical base64url parts, a JSON header and a JSON payload; no `crit` header                               | `token-malformed`                                 |
| `alg` is one of the registration's `algorithms`, by default RS256, RS384, RS512, ES256, ES384 and ES512; `none`, the HMAC algorithms and every other are refused before a key is fetched | `algorithm-unsupported` |
| The header has a `kid` that one key of the key set has, a key for the algorithm: RSA of 2,048 bits or more, or EC on P-256, P-384 or P-521; the key set is a JWK Set | `key-unknown` |
| The signature verifies with that key                                                                                            | `signature-invalid`                               |
| `iss` equals the registration's issuer                                                                                          | `issuer-mismatch`                                 |
| `aud` holds the client identifier and names no other party than the registration's `trustedAudiences`; a token with several audiences has `azp`; `azp`, when present, is the client identifier | `audience-mismatch`, `audience-untrusted`, `authorized-party-missing`, `authorized-party-mismatch` |
| `exp` is later than the time minus 60 seconds; `iat` is not later than the time plus 60 seconds                                 | `token-expired`, `issued-in-future`               |
| `nonce` is present and equals the login's                                                                                       | `nonce-mismatch`                                  |
| The message type is one of the five that a platform sends (see [messages](model.md)) or of `otherMessageTypes`; the version is one of `versions`, `1.3.0` by default | `message-type-unsupported`, `version-unsupported` |
| `deployment_id` is one of the registration's                                                                                    | `deployment-unknown`                              |
| The claims of the message type have the shape of the specifications                                                             | `claim-missing`, `claim-invalid`                  |
| `deployment_id` is the login's `lti_deployment_id`, when the initiation named one                                               | `deployment-mismatch`                             |
| `target_link_uri` is the login's                                                                                                | `target-mismatch`                                 |
| With `legacySecret`: the secret of the `lti1p1` claim's consumer key is looked up and `oauth_consumer_key_sign` checked against it | The lookup's rejection                         |
| The store deletes the login                                                                                                     | `state-reused`                                    |

A host answers with the `status` of an `LtiError`, which the table of errors below gives, and with 400 for a `DataError`.

### The launch

`handleLaunch` returns an `LtiMessage` or an `HttpResponse`: the second post of the storage path is answered with the verification page, which the route sends to the browser as it is. Tell them apart with `"status" in result`, which is true for the `HttpResponse`; an `LtiMessage` has a `messageType`. A launch that fails a check does not return: it throws an `LtiError` with a `reason` and a `status`, and the route answers with them.

An `LtiMessage` is a union by `messageType`; [Messages and vocabularies](model.md) lists every property. The ones a tool reads first:

| Property                             | Meaning                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `issuer`, `clientId`, `deploymentId` | The platform, the tool's client and the deployment                                                                       |
| `targetLinkUri`                      | The `target_link_uri` claim, which equals the parameter of the login                                                     |
| `user`                               | `subject`, the user's `sub`, absent in an anonymous launch, and the identity claims: names, email, picture, locale       |
| `roles`                              | The role URIs, as the platform sent them; `canonicalizeRole` maps a deprecated simple name to its URI                    |
| `context`, `platform`, `presentation` | The `context`, `tool_platform` and `launch_presentation` claims                                                         |
| `custom`                             | The custom properties of the link, a `Map`                                                                               |
| `services`                           | The service claims: `grades` has `scopes`, `lineitems` and `lineitem`, `roster` the `contextMembershipsUrl`, `groups` the group URLs and `preferences` the host and the activities; a service the platform does not offer is absent  |
| `claims`                             | Every claim of the token as JSON, vendor claims among them                                                               |
| `migration`                          | The `lti1p1` claim, with `verified` true only when `legacySecret` gave the secret that signs its consumer key            |
| `resourceLink`                       | `LtiResourceLinkRequest`: `id`, `title`, `description`                                                                   |
| `settings`                           | `LtiDeepLinkingRequest`: the ten settings of Deep Linking 4.4.1, `returnUrl`, `acceptTypes` and `data` among them        |

A message holds a `Map`; a host that stores it converts `custom` to an array of entries.

**The LTI 1.1 migration claim.** A platform that moved from LTI 1.1 signs the `oauth_consumer_key` of the integration with the
shared secret of 1.1 (`oauth_consumer_key_sign`, the Migration Guide). With `legacySecret`, `handleLaunch` asks the host for that
secret by consumer key and sets `migration.verified`; the host maps the 1.1 `user_id` and `context_id` to its records only when it
is `true`. The secret is used for one HMAC and kept nowhere.

## Deep Linking

When `handleLaunch` returns a Deep Linking request, the host lets the user choose, then answers with `buildDeepLinkingResponse(launch,
response, options)`: the items are checked against what the request accepts, the response is signed with the registration's
`signer`, and the result is the page that posts it to `launch.settings.returnUrl`, also when no item was chosen (Deep Linking 2.0
section 2.3). The [Deep Linking guide](deep-linking.md) has the five item types, the checks and the platform's reader.

## Proctoring

When `handleLaunch` returns a Start Proctoring message, the proctoring tool checks the candidate and the room, then sends the browser
back with `buildStartAssessmentPage(launch, input, options)`: the page posts the signed Start Assessment message, which returns the
session data, the resource link and the attempt of the launch, to `launch.startAssessmentUrl`. During and after the attempt the tool
calls the Assessment Control Service of `launch.assessmentControl` with `control` of `createServiceClient`. The
[proctoring guide](proctoring.md) has the verified claims, the actions and the platform's side.

## Dynamic Registration

A tool registers itself with a platform in steps, so that the host may show its own pages between them:
`readRegistrationInitiation(request)` at the initiation route, behind the session of the tool's administrator;
`discoverPlatform(initiation, { fetch })`, which checks that the configuration lies below its issuer; `registerTool(platform, tool,
initiation, { fetch })`; `buildPlatformRegistration(platform, result, { signer, redirectUri })`, the record that the host keeps; and the
page of `buildRegistrationClosePage()`. The [registration guide](registration.md) has the checks, the options and the platform's
side.

## The tool's key set

The platform verifies the tool's client assertions and Deep Linking responses with the tool's public keys. `serveToolJwks(request,
keys, options)` answers the route of the key set URL that the platform's administrator registered: a GET with `{ "keys": [...] }`
and `Cache-Control: public, max-age=3600`, a HEAD with the headers alone, and any other method with 405. `keys` is the `KeySet` of
the tool: its `signer` and the `publicKeys` that it publishes, each with a `kid`. A key with a private member, a `kid` used
twice, or a signer whose `keyId` no public key has is a `DataError`, so it never reaches a platform.

```ts
import { createCryptoKeySigner } from "@interopkit/core";
import { serveToolJwks } from "@interopkit/tool-integration/tool";

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "tool-2026-11", alg: "ES256", use: "sig" };
const keys = { signer: createCryptoKeySigner(pair.privateKey, { algorithm: "ES256", keyId: "tool-2026-11" }), publicKeys: [publicKey] };
const answer = serveToolJwks({ method: "GET", url: "https://tool.example.com/jwks", headers: {}, body: new Uint8Array() }, keys);
answer.headers["cache-control"]; // => "public, max-age=3600"
JSON.parse(answer.body).keys[0].kid; // => "tool-2026-11"
```

**Rotation** (Security Framework section 6.4). Add the new public key to `publicKeys`; wait one `max-age`, so that every platform
has fetched it; switch the registrations' `signer` and the key set's `signer` to the new key; keep the old public key until every
token that it signed has expired (300 seconds), plus one `max-age`; then remove it.

## Access tokens and the services

The client of the services, `createServiceClient`, asks the platform for access tokens with `requestClientCredentialsToken` of
[`@interopkit/core/oauth`](../core/oauth.md) and `private_key_jwt`: a form to `accessTokenUrl` with
`grant_type=client_credentials`, `client_id`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`,
`client_assertion` and `scope`, as Security Framework section 4.1.1 describes. The registration's `signer` signs the assertion:
`iss` and `sub` the client identifier, `aud` the token endpoint (or the `audience` of the registration), `iat`, `exp` (300
seconds later), a new `jti`, and the deployment claim (LTI 1.3 Core section 6.2.1). It keeps a token for each scope until it
is about to expire, and sends it only to the registration's `serviceOrigins`, or to an `https` URL that names a public host. The
[grade services](grades.md) guide has the methods, the options, the timestamps of scores and the errors; the [roster services](roster.md) guide has the members, the groups and the preferences record; the [proctoring](proctoring.md) guide has the Assessment Control Service.

## The key set cache

`createJwksCache({ fetch, clock })`, which the package exports from [`@interopkit/core`](../core/signals.md), keeps the key set of
each URL, which comes from a registration and never from a token, as a `createLocalJWKSet` of jose in a `createKeyedCache`.
`cache.keySet(url, options)` returns the function that resolves the public key of a token from its header, and `jwtVerify` of
jose takes it. The `signal` of `options` ends the wait of the caller that holds the function; the fetch is shared work and runs
on to its own timeout.

| Option           | Meaning                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `fetch`          | The `fetch` that gets the key sets                                       |
| `clock`          | The time that the lifetimes are counted by; `SYSTEM_CLOCK` when left out |
| `ttlSeconds`     | How long a set stays cached. Default: `3600`.                            |
| `refreshSeconds` | The least time between two fetches of a set that answers. Default: `60`. |
| `timeoutMs`      | The most time one fetch may take. Default: `10000`.                      |

A set that is older than `ttlSeconds` is fetched again. A `kid` that the cached set lacks fetches it again only after
`refreshSeconds` (Security Framework section 6.4: the platform adds a rotated key under a new `kid`), so a token with an invented
`kid` cannot make the tool fetch on every request while the platform's key set answers. A key set that fails is not held back: each request that needs it fetches it again, so limit the rate of requests to the launch URL. Requests that wait for one fetch share it. The set resolves the key that
has the `kid` and is meant for signing with the algorithm of the token (`use` is `sig` or absent, `alg` is that algorithm or absent, `key_ops` has
`verify` when present); a `kid` that two keys share is refused, and a set that is not a JWK Set (RFC 7517 section 5) is not kept
and refuses the launch with `key-unknown`, as a set without the `kid` does. A key of fewer than 2,048 bits does not verify (RFC 7518 section 3.3). The cache keeps 1,000 key
sets at most: the one fetched first goes first.

## Calls to the platform

`fetch` is an option and nothing else calls the network. The functions that do (`createJwksCache` and the client of
`createServiceClient`) go through `requestService` of [`@interopkit/core`](../core/service.md): a time limit, no redirect (it could
leave HTTPS) and a limit on the bytes of the answer (64 KiB for a key set, `maxBytes` for a service). A failure is a
`ServiceError`: its `status` is the HTTP status, or `0` when the platform did not answer. A token answer that is not one is a
`ServiceError` too; a body that is not what the specification describes is a `DataError`.

The key set and the token endpoint come from a registration, and the URLs of the services from a claim or an answer of a platform,
which pass the rule of the service origins above. That rule sees only the URL: a tool that serves many platforms, whose administrators it does not control, passes a
`fetch` that refuses loopback, private and link-local addresses. The check must be on the address that the connection resolves
to and not on the host name, or DNS rebinding gets through: a name that is public when it is checked can be private when the
connection is made. Resolve the name once, refuse the address if it is in one of those ranges (the metadata address
`169.254.169.254` among them, and an IPv4 address written as IPv6), and connect to that address; in Node.js that is a `lookup`
function in the options of the connection. See [SECURITY](../../SECURITY.md).

## The clock

`clock.now()` answers whole milliseconds, as `Date.now()` does ([clock](../core/clock.md)). The functions and the key set cache
read no other clock.

## Deployment

- Serve every route over HTTPS, and limit the size of a request body: the handlers read what the host gives them.
- Route the login URL to `handleLogin`, and the redirect URI to `handleLaunch` for both requests of the storage path.
- Pass the `cookie` and `origin` headers of every launch, in lower case.
- Check `launch.targetLinkUri` against your own routes before you redirect to it.
- Make `LtiStore.delete` atomic, and delete expired records.
- Start the host's own session after `handleLaunch` returns a launch; the state cookie serves the login only.
- Keep the tool's private key in the host's key store or a KMS, behind a `Signer`, and serve its public keys with
  `serveToolJwks`; rotate them as the key set section shows.
- Name `serviceOrigins` in the registration of a platform whose services are on a private network.

## Options

| Option         | Default                                             | Meaning                                                     |
| -------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `registration` | required                                            | Looks up the registration of a platform (see Registrations) |
| `clock`        | `SYSTEM_CLOCK`                                      | The source of the time                                      |
| `store`        | required for `handleLogin` and `handleLaunch`             | The store of logins                                         |
| `jwks`         | required for `handleLaunch`                            | The cache of key sets                                       |
| `fetch`        | required for `createServiceClient`                  | The `fetch` that calls the platform ([grade services](grades.md) has the other options of the client) |
| `versions`     | `["1.3.0"]`                                         | `handleLaunch`: the values of the `version` claim that it accepts |
| `otherMessageTypes` | none                                           | `handleLaunch`: message types beyond the five modeled ones, returned as an `OtherMessage` with every claim, such as those of a specification that the package does not implement |
| `maxFormBytes` | 65,536                                              | `handleLaunch`: the most bytes of the posted form              |
| `legacySecret` | none: the migration claim is never verified         | `handleLaunch`: returns the LTI 1.1 secret of a consumer key, or `undefined` |
| `signal`       | none                                                | Ends this caller's wait (see Signals)                       |

| Limit                                   | Value        |
| --------------------------------------- | ------------ |
| Lifetime of a login                     | 600 seconds  |
| Bytes of a login initiation form        | 65,536       |
| Wait for the answer to `lti.capabilities` | 100 milliseconds |
| `max-age` of the tool's key set (`maxAgeSeconds` of `serveToolJwks`) | 3,600 seconds |
| Lifetime of a client assertion          | 300 seconds  |
| Lifetime of a Deep Linking response     | 300 seconds  |
| Leeway for clock skew                   | 60 seconds   |
| Most bytes of a key set of the platform | 65,536       |
| Most keys of a key set of the platform  | 100          |
| Most key sets that the cache keeps      | 1,000        |
| Most bytes of an answer of a service    | 1,048,576 (`maxBytes` of `createServiceClient`) |
| Key set `ttlSeconds`, `refreshSeconds`  | 3,600 and 60 |

## Failure paths

| Port or call                       | Fails                                                                                                                                  | Hangs                                                                                | Called again                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `registration`                     | Rejects: the call rejects. `undefined`: `platform-unknown`                                                                             | It receives the `signal` and bounds itself                                           | Pure; a host may cache                                                                                            |
| `LtiStore.put`                     | `handleLogin` rejects and sends no redirect                                                                                               | It receives the `signal` and bounds itself                                           | Each login has a new `state`                                                                                      |
| `LtiStore.get`                     | `handleLaunch` rejects; the login stays                                                                                                   | The same                                                                             | Reads only                                                                                                        |
| `LtiStore.delete`                  | `handleLaunch` rejects after validation, and the platform may post again until the login expires                                          | The same                                                                             | Atomic: of two calls one gets `true`, and the other is `state-reused`. An unfinished login expires at `expiresAt` |
| The key set                        | Fresh keys are unaffected. Past `ttlSeconds` the call rejects with `ServiceError`: launches fail closed, and stale keys are never used | Shared work: it runs to `timeoutMs`; one caller's abort ends only that caller's wait | An unknown `kid` fetches once, at most every `refreshSeconds`, then `key-unknown`. Callers share one fetch        |
| The call to the platform (`fetch`) | `ServiceError` with the status, or 0 when there was no answer                                                                          | `timeoutMs`, then `ServiceError` with status 0                                       | A token request is safe: a new `jti`. A score needs a later timestamp                                             |
| `legacySecret`                     | `handleLaunch` rejects with its error, and the login stays                                                                                | It receives the `signal` and bounds itself                                           | Once per launch with a migration claim                                                                            |
| The `signer`                       | The call rejects with its error; nothing half-signed is sent                                                                           | It receives the `signal`                                                             | An ECDSA signature differs from call to call; each verifies                                                       |

## Signals

| Point                                          | Effect of an aborted signal                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `handleLogin`, before `put`                       | Rejects with `signal.reason`; nothing is saved. After `put`, an orphan record expires                                       |
| `handleLaunch`, before `store.delete`             | Rejects with `signal.reason`; the login stays, and the platform may post again. After `delete` starts, the launch completes |
| `buildDeepLinkingResponse`, in the registration lookup or the signer | Rejects with `signal.reason`                                                                                |
| `handleLaunch`, in `legacySecret`                 | Rejects with `signal.reason`; the login stays                                                                               |
| A call of the service client                   | Rejects with `signal.reason`; a token request it shares runs on. A score in flight is in doubt: resend with a later timestamp |
| A key set fetch                                | One caller's abort ends that caller's wait. The fetch runs on for the others, to `timeoutMs`                                |

## Errors

| Error                                                                                                                                                                                                                 | When                                                                        | Status                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| `LtiError` `token-malformed`, `algorithm-unsupported`, `key-unknown`, `signature-invalid`, `issuer-mismatch`, `audience-mismatch`, `audience-untrusted`, `authorized-party-missing`, `authorized-party-mismatch`, `token-expired`, `issued-in-future`, `nonce-mismatch` | The `id_token` fails validation                                             | 401                                            |
| `LtiError` `state-unknown`, `state-expired`, `state-reused`, `state-cookie`, `origin-mismatch`, `storage-mismatch`, `deployment-mismatch`                                                                             | The launch is not bound to a login of the tool                              | 403                                            |
| `LtiError`, other reasons                                                                                                                                                                                             | The platform broke the protocol, or a scope is not available                | 400                                            |
| `LimitError`, a `DataError`                                                                                                                                                                                           | A form is over `maxFormBytes`, or the initiation of a login over 65,536 bytes; `limit` names the limit and `maximum` its value | 413                                            |
| `DataError`                                                                                                                                                                                                           | An argument or a request has the wrong shape                                | 400                                            |
| `ServiceError`                                                                                                                                                                                                        | The platform did not answer, or answered with an error                      | 502 or 504 for a host that proxies the failure |

## Data flows

| Data                                                        | Comes from                         | Goes to                                                            | Kept by the package                    |
| ----------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| The claims of a launch: `sub`, roles, names, e-mail, custom | The platform's `id_token`          | The `LtiMessage` that `handleLaunch` returns to the host               | No                                     |
| `state` and `nonce` of a login                              | `handleLogin`                         | The host's `LtiStore`, and the browser (the cookie or the storage) | Only in the store, until used or 600 s |
| The client assertion                                        | Signed by the tool's `signer`      | The platform's token endpoint                                      | No                                     |
| The LTI 1.1 secret of a consumer key                        | `legacySecret`                     | One HMAC of the migration claim                                    | No                                     |
| The access token                                            | The platform's token endpoint      | The services of the platform, in the `Authorization` header, and the host's `TokenStore` when given | In the memory of the client, until near its expiry |
| A score                                                     | The host                           | The platform's score service                                       | No                                     |
| The answer of a service that failed                         | The platform                       | `ServiceError.body`, to the host: treat it as untrusted text       | No                                     |

## Differences from the references

The references were read for what they do where a specification leaves room; [spec-gaps](spec-gaps.md) lists where the text and
an example disagree.

| Reference                               | What it does                                                                            | What this package does                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| PyLTI1p3                                | Does not read `expires_in` of a token response; names the audience with `auth_audience` | Reads `expires_in` when it is there; the registration has an optional `audience` |
| PyLTI1p3                                | Appends `/scores` to the line item URL after handling a trailing slash                  | The same: one trailing slash is dropped first                                    |
| A launch from Canvas, published in 2020 | Sends `null` for a title and a description, and a number in `custom`                    | Reads `null` as absent and a number or a boolean as its text                     |

## Not included

| What                                                                                                            | Reason                                                                       |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| LTI 1.0 to 1.2, Basic Outcomes                                                                                  | 1EdTech retired them; a launch of that form is refused                       |
| Sessions, routes, a database, a UI for Deep Linking                                                             | The host's                                                                   |
