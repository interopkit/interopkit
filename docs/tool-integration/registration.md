# LTI Dynamic Registration

Dynamic Registration 1.0 in both roles. A platform's administrator opens the tool's initiation URL with the address of the
platform's OpenID configuration and a registration token; the tool discovers the platform, registers with it, and closes the
window; each administrator then reviews and activates its side. In the tool role, `readRegistrationInitiation`, `discoverPlatform`,
`registerTool`, `buildPlatformRegistration` and `buildRegistrationClosePage` are the steps, so that the host may show its own pages
between them, and the service client reads and changes the registration later. In the platform role, `buildRegistrationInitiation`
starts a registration, `handlePlatformRequest` serves the configuration, the registration endpoint and the client configuration
endpoint over the host's `RegistrationStore`, and `buildToolRegistration` turns a reviewed registration into the record of a tool. The
configurations are the [service models](services.md) that both roles share.

```mermaid
sequenceDiagram
  participant A as Platform administrator
  participant P as Platform role
  participant B as Browser
  participant T as Tool
  A->>P: buildRegistrationInitiation(initiation URL)
  P-->>B: initiation URL, openid_configuration, registration_token (single use, an hour)
  B->>T: readRegistrationInitiation
  T->>P: discoverPlatform: GET the configuration, with the token
  T->>T: the configuration is below its issuer; every endpoint names a public host
  T->>P: registerTool: POST /registration, with the token
  P->>P: token spent, configuration validated, scopes narrowed
  P->>A: RegistrationStore.register
  P-->>T: 201: client_id, registration_client_uri, the recorded configuration
  T-->>B: buildRegistrationClosePage: org.imsglobal.lti.close
  A->>P: buildToolRegistration(registered, grant): the tool is active
  T->>T: buildPlatformRegistration: the platform is active
  T->>P: getToolRegistration, updateToolRegistration: a token of lti-reg
```

| Role     | Function                                                     | Does                                                                                     |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Tool     | `readRegistrationInitiation(request)`                        | Reads the address of the configuration and the token from the initiation request        |
| Tool     | `discoverPlatform(initiation, options)`                      | Fetches the configuration and checks it against its address                              |
| Tool     | `registerTool(platform, tool, initiation, options)`          | Posts the tool's configuration and returns the registration that the platform recorded   |
| Tool     | `buildPlatformRegistration(platform, result, tool)`             | Returns the tool's record of the platform                                                |
| Tool     | `buildRegistrationClosePage()`                              | Returns the page that tells the platform's window to close                               |
| Tool     | `createServiceClient(deployment, options).getToolRegistration(result)`, `.updateToolRegistration(result, tool)` | Read and change the registration                   |
| Platform | `buildRegistrationInitiation(initiationUrl, options)`       | Returns the initiation URL with the configuration and a single-use registration token     |
| Platform | `handlePlatformRequest(request, options)`                    | With `services.registrations`, serves the configuration, `/registration` and `/registration/{client}` |
| Platform | `buildToolRegistration(registered, grant)`                      | Returns the `ToolRegistration` of a reviewed tool, with the scopes and deployments granted |

## Quick start

A tool reads the initiation request of a platform. The sample builds the request by hand where a host passes the one it received.

```ts
import { readRegistrationInitiation } from "@interopkit/tool-integration/tool";

const query = new URLSearchParams({
  openid_configuration: "https://lms.example.edu/.well-known/openid-configuration",
  registration_token: "eyJhbGciOiJIUzI1NiJ9.e30.token",
});
const initiation = readRegistrationInitiation({
  method: "GET",
  url: `https://tool.example.com/lti/register?${query}`,
  headers: {},
  body: new Uint8Array(),
});
initiation.openidConfiguration; // => "https://lms.example.edu/.well-known/openid-configuration"
initiation.registrationToken; // => "eyJhbGciOiJIUzI1NiJ9.e30.token"
```

The next steps call the platform: `discoverPlatform(initiation, { fetch })`, then `registerTool(platform, tool, initiation, { fetch })`.
A whole flow runs in the [example](../../examples/tool-integration/README.md): `src/registering-tool.ts` is a tool that registers
itself, `src/registration.ts` holds the platform's registrations, and the scenario activates both sides and reads the registration
back.

## The tool role

The initiation route is public by nature: anyone can send a browser to it. The host puts it behind the session of the tool's
administrator before `discoverPlatform` runs, and may keep the `RegistrationInitiation`, plain data, in that session while it shows
its own pages.

`discoverPlatform(initiation, options)` fetches the configuration and checks it:

| Check                                                                                         | Refused with                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| The address names a public host (`checkRemoteUrl`), before anything is fetched               | `LtiError` `service-origin-refused`            |
| No redirect; the answer within `maxBytes` and `maxTokens`                                    | `ServiceError`, `DataError`                    |
| The configuration holds to section 2.1: `private_key_jwt`, `RS256`, `openid`, `id_token`, https endpoints, an issuer without query or fragment | `DataError` |
| The address is below the issuer (section 3.4): the same origin after parsing, a path equal to the issuer's or below it at a slash, no fragment | `LtiError` `issuer-mismatch` (401) |
| Every endpoint (authorization, registration, key set, token) names a public host             | `LtiError` `service-origin-refused`            |

The registration token goes with the GET of the configuration, because some platforms require it there and give the address and
the token in one redirect.

`registerTool(platform, tool, initiation, options)` posts the configuration as `application/json`, with the token as a bearer token.
The tool gives a `ToolConfigurationInput`: what section 2.2 has a tool say, without what LTI fixes, which the library writes:
`application_type` `web`, the response type `id_token`, the grant types `implicit` and `client_credentials`, and `private_key_jwt`.

| Property of the input                     | Meaning                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `initiateLoginUri`, `redirectUris`        | The login initiation URL and the launch URLs                                                  |
| `clientName`, `logoUri`, `clientUri`, `tosUri`, `policyUri`, `contacts` | What the platform shows of the tool                                   |
| `jwksUri`                                 | The tool's key set, which `serveToolJwks` answers                                             |
| `scope`                                   | The scopes of the services that the tool asks for, space-separated; the platform may grant fewer or more |
| `lti`                                     | `domain`, `targetLinkUri`, `messages` with their placements, `claims`, `customParameters`, `description` |
| `localized`                               | Translations, such as `client_name#ja`                                                         |

The registration endpoint must be on the origin of the issuer, or on one of `registrationOrigins`, since the token goes there; so
must the `registration_client_uri` of the answer. A platform answers at once, and the tool is active only after its administrator
reviews it. Then the host:

1. Keeps the `ToolRegistrationResult`, which the client of the services reads and changes later.
2. Makes its record of the platform with `buildPlatformRegistration(platform, result, { signer, redirectUri, deploymentIds })`: the
   issuer, the authorization, token and key set endpoints, the `authorization_server` as the audience of client assertions, and the
   client identifier. `deploymentIds` defaults to the `deployment_id` of the answer, when the platform combined registration and
   deployment; without one, the host gives it.
3. Sends the browser `buildRegistrationClosePage()`, whether the registration succeeded or not (section 3.7).

`getToolRegistration(result)` and `updateToolRegistration(result, tool)` of `createServiceClient` read and change the registration at
its `registration_client_uri`: with the `registration_access_token` of the result when the platform gave one, else with an access
token of `registration.readonly` or `registration` (section 4.2). An update may stay pending until the platform's administrator
accepts it, and the answer must be of the same client.

| Option of `discoverPlatform` and `registerTool` | Default   | Meaning                                                                         |
| ----------------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `fetch`                                         | required  | The `fetch` that calls the platform; it refuses private addresses after resolution |
| `timeoutMs`                                     | 10,000    | The most time that a call may take                                              |
| `maxBytes`                                      | 65,536    | The most bytes of an answer                                                     |
| `maxTokens`                                     | 1,000,000 | The most JSON tokens of an answer                                               |
| `registrationOrigins` (of `registerTool`)       | none      | Origins besides the issuer's for the registration and client configuration endpoints |
| `signal`                                        | none      | Ends this caller's wait                                                         |

## The platform role

The host gives `handlePlatformRequest` a `RegistrationStore` as `services.registrations`. Dynamic Registration needs three things of
the platform, which the options check: the issuer on `config.origin` (the configuration lies below it), a signer of RS256 (section
2.1.1 requires it among the algorithms of an `id_token`), and the `productFamilyCode` of `config.instance`.

| Route                                                  | Methods  | Answers                                                                              |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| The issuer's path, then `/.well-known/openid-configuration` | GET | The configuration of section 2.1                                                  |
| `/registration`                                        | POST     | A registration, with the token of `buildRegistrationInitiation`                     |
| `/registration/{client}`                               | GET, PUT | The registration of the calling tool, with an access token of a scope of `lti-reg`   |

The configuration names the endpoints, `private_key_jwt` with the six approved algorithms, `openid` and the scopes of every service
whose store is given, `id_token`, the algorithm of the signer, the variables that the message answers and those of `substitution`,
and what `discovery` and `config.instance` say.

| Option of `handlePlatformRequest` | Default                                    | Meaning                                                                    |
| --------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `services.registrations`          | none                                       | The `RegistrationStore`; without it none of the three routes exists        |
| `openRegistration`                | `false`                                    | Accepts a registration without a token; the store then caps pending registrations |
| `discovery.messagesSupported`     | the five message types of `MessageInput`   | The messages of the configuration, with their placements                   |
| `discovery.claimsSupported`       | `iss`, `sub`, the names, `email`, `email_verified`, `picture`, `locale` | The claims of a user that the messages carry    |
| `discovery.subjectTypesSupported` | `["public"]`                               | `public` or `pairwise`                                                     |
| `maxBodyBytes`                    | 65,536                                     | The most bytes of a registration or an update                              |

`buildRegistrationInitiation(initiationUrl, { config, clock, ttlSeconds })` returns the address that the administrator's page opens:
the tool's initiation URL with `openid_configuration` and a `registration_token`, sealed with the hint key, that names one
registration for `ttlSeconds` (3,600 by default).

The registration endpoint checks, in order:

| Check                                                                                   | Answer                                  |
| --------------------------------------------------------------------------------------- | --------------------------------------- |
| A POST                                                                                  | 405                                     |
| The token: sealed by this platform (or an earlier hint key), not expired, used once through `once`, before the body is read; none only with `openRegistration` | 401 `invalid_token` |
| `application/json`, within `maxBodyBytes`                                               | 415, 413                                |
| The configuration of section 2.2                                                        | 400 `invalid_client_metadata`           |
| Every redirect URI names a public host on none of the platform's origins               | 400 `invalid_redirect_uri`              |
| Every other address (login, key set, logo, terms, policy, target links, icons, their translations) does too | 400 `invalid_client_metadata` |
| The store registers it, with the scopes narrowed to those the platform offers           | 201, or 400 with the `reason` and the `message` of the store's `RegistrationRefusal` (`invalid_client_metadata` or `invalid_redirect_uri`) |

The answer carries the recorded configuration, the `client_id` and the `registration_client_uri`, and no
`registration_access_token`: the tool reads and changes its registration with an access token of the token endpoint. A token is spent
also when the configuration is refused, so the tool starts again from the initiation. `/registration/{client}` answers 404 to a tool
whose token is of another client, takes an update as it takes a registration, and refuses one whose `client_id` is another's.

The client configuration endpoint is optional (section 4), and so are `get` and `update` of the store; `register` is required. A
store without both answers no `registration_client_uri`, `/registration/{client}` names nothing, and the scopes of `lti-reg` are
neither listed in the configuration nor granted. A store with one serves its method, answers 405 to the other, and offers only the
scope that it needs: `registration.readonly` for `get`, `registration` for `update`.

When the administrator activates a tool, the host gives `buildToolRegistration(registered, { scopes, deploymentIds })` to its lookup of
tools: the login initiation URL, the redirect URIs, the key set URL and the custom properties of the configuration, with the scopes
and the deployments that the administrator grants.

## Limits

| Limit                                         | Value                    |
| --------------------------------------------- | ------------------------ |
| A registration token                          | 3,600 seconds, once      |
| A registration or an update at the platform   | 65,536 bytes             |
| An answer that the tool reads                 | 65,536 bytes, 1,000,000 JSON tokens |
| A call of the tool                            | 10,000 ms                |

## Failure paths

| Port                  | Fails                                                              | Hangs                | Called again                                                                 |
| --------------------- | ------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------- |
| `RegistrationStore`   | 500 with nothing of the cause; a refusal is 400; an answer that is not one is a `DataError` | `signal` | The token is spent, so a retry after a timeout is 401 and the tool restarts from the initiation |
| `once`                | 500, nothing registered; a value that is not a boolean is a `DataError` | `signal`      | `false` is 401                                                               |
| The tool's `fetch`    | `ServiceError`; nothing retries                                    | `timeoutMs`          | A registration is not idempotent: a retry is a new registration, unless the token was spent |

## Errors

| Error                                               | When                                                                                     | What to do                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `LtiError` `request-invalid`                        | The initiation request is not a GET with one `openid_configuration`                      | Answer 400                                                    |
| `LtiError` `service-origin-refused`                 | An address of the platform names no public host                                         | Stop; the administrator checks the platform                   |
| `LtiError` `issuer-mismatch`                        | The configuration is not below its issuer, or an address of registration is on another origin | Stop: the configuration may impersonate another platform; name a trusted origin in `registrationOrigins` |
| `DataError` from the tool's steps                   | An argument has the wrong type, or the platform's configuration or answer breaks the specification | Fix the caller; the platform's answer is refused       |
| `ServiceError` from `registerTool`                  | The platform refused the registration (400 with `invalid_client_metadata`) or did not answer | Read `body`; the administrator starts again                 |
| `DataError` from `handlePlatformRequest`            | The platform cannot serve Dynamic Registration, or a port broke its contract             | Fix the configuration or the port                             |

## Data flows

| Data                                          | Comes from         | Goes to                                       | Kept by the package |
| --------------------------------------------- | ------------------ | --------------------------------------------- | ------------------- |
| The registration token                        | The platform       | The tool, then back to the platform, once     | No                  |
| The tool's configuration: names, contacts, addresses | The tool    | The host's `RegistrationStore`                | No                  |
| The registration access token of another platform | That platform  | The host's record, then that platform's endpoint | No               |

The configuration's `client_name`, `logo_uri` and the other texts and addresses are data: the platform's pages that show them to an
administrator escape them, and fetch a logo, if at all, through the host's guarded `fetch`.

## Not included

| What                                                             | Reason                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| The review screen, the activation and the deployments            | The host's: the store keeps the registrations, `buildToolRegistration` makes the record |
| A `registration_access_token` issued by the platform role        | Section 4.2 lets a tool use an access token of the token endpoint, which the platform checks against the registration on every call |
| A provisional update applied later                               | The host's: section 4 leaves the mechanism to the platform                  |

## Differences from the references

No reference implementation of the platform role was found; both roles are checked against the text, the examples of section 2
and each other, in process and in the [example](../../examples/tool-integration/README.md). The examples of section 2.2.5 and 2.3
differ from the text, and a platform that signs with another algorithm than RS256 cannot serve the configuration that section 2.1.1
requires: [spec-gaps](spec-gaps.md) lists the choices.
