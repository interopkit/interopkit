# @interopkit/tool-integration

LTI 1.3 for JavaScript and TypeScript, in the tool and the platform role: launches, Deep Linking, Assignment and Grade Services,
Names and Role Provisioning, Context Groups, Proctoring and Dynamic Registration.

| Role     | Your application                   | The package                                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool     | Is launched by a learning platform | Answers the login, validates the launch of every message type, serves the key set, answers Deep Linking, sends a proctored candidate back to start, reads and writes the gradebook, reads members, groups and preferences records, controls a proctored attempt, and registers through Dynamic Registration                                                                                    |
| Platform | Launches tools                     | Keeps the message of a launch in your store and starts the tool's login; one handler answers the authentication request with the `id_token` and serves the key set, access tokens, the storage page, the grade and roster services, the Assessment Control Service and Dynamic Registration over your stores; two functions read the tool's Deep Linking response and Start Assessment message |

A handler takes an `HttpRequest` and returns an `HttpResponse` of
[`@interopkit/core/http`](https://interopkit.wakan.dev/_interopkit/core/http/), plain objects that any web framework builds. You
pass in the stores, the registrations, a `fetch` and a clock.

```bash
npm install @interopkit/tool-integration
```

## Quick start

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
const logins = new Map();
const clock = { now: () => Date.now() };
const options = {
  registration: async () => registration,
  clock,
  store: {
    put: async (state, record) => void logins.set(state, record),
    get: async (state) => logins.get(state),
    delete: async (state) => logins.delete(state),
  },
  jwks: createJwksCache({ fetch, clock }),
};

const login = new URL("https://tool.example.com/lti/login");
login.search = new URLSearchParams({
  iss: registration.issuer,
  login_hint: "user-1",
  target_link_uri: "https://tool.example.com/lti/launch",
}).toString();
const response = await handleLogin({ method: "GET", url: login.href, headers: {}, body: new Uint8Array() }, options);
response.status; // => 302
logins.size; // => 1
```

A failure throws `LtiError` for a check of the specifications (with its `reason`), `DataError` for a malformed request or
option, and `ServiceError` for a platform that does not answer.

## Architecture

```mermaid
flowchart LR
  platform["Learning platform"]
  subgraph host["Your application"]
    routes["Routes<br/>login URL, launch URL"]
    ports["Ports<br/>LtiStore, LaunchStore, GradebookStore,<br/>registration lookup, fetch, Clock"]
  end
  subgraph pkg["@interopkit/tool-integration"]
    tool["/tool<br/>handleLogin, handleLaunch, serveToolJwks,<br/>buildDeepLinkingResponse, buildStartAssessmentPage,<br/>createServiceClient"]
    platformRole["/platform<br/>prepareToolLaunch,<br/>handlePlatformRequest"]
    root["root<br/>LtiError, createJwksCache,<br/>the model of messages, vocabularies"]
  end
  http["@interopkit/core/http<br/>HttpRequest, HttpResponse"]
  platform <-->|"login, launch, tokens, scores"| routes
  routes --> tool
  routes -.->|"HttpRequest, HttpResponse"| http
  tool --> ports
  platformRole --> ports
  tool --> root
  platformRole --> root
```

It runs in Node.js, browsers, Deno, Bun and Cloudflare Workers: it uses web standards only, reads no environment variable,
writes no log, and calls the network only through the `fetch` that you pass. Its dependencies are
[`@interopkit/core`](https://interopkit.wakan.dev/_interopkit/core/), [jose](https://github.com/panva/jose) and
[valibot](https://valibot.dev). [Supported](https://interopkit.wakan.dev/_interopkit/tool-integration/supported/) lists what it
includes and what it does not.

## API

| Subpath                                 | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@interopkit/tool-integration`          | `LtiError`, with a `reason` and an HTTP `status`; `createJwksCache`, `JwksCache`, `JwksCacheOptions`; the model of the messages: `LtiMessage`, `ToolMessage`, the seven message types (`ResourceLinkMessage`, `DeepLinkingRequestMessage`, `SubmissionReviewMessage`, `StartProctoringMessage`, `EndAssessmentMessage`, `DeepLinkingResponseMessage`, `StartAssessmentMessage`, `OtherMessage`) and their parts; `KeySet`; the vocabularies `SYSTEM_ROLES`, `INSTITUTION_ROLES`, `CONTEXT_ROLES`, `CONTEXT_SUB_ROLES`, `LTI_SYSTEM_ROLES`, `CONTEXT_TYPES`; `canonicalizeRole`, `canonicalizeContextType`, `APPROVED_ALGORITHMS`, `SCOPES`, `MESSAGE_TYPES`; the models of the bodies of the services: `LineItem`, `LineItemInput`, `Score`, `Result`, `Membership`, `Member`, `GroupContainer`, `GroupSetContainer`, `ContentItem` and its five types, `PlatformConfiguration`, `ToolConfiguration`, `ToolRegistrationResult`, `ControlRequest`, `ControlStatus`, `PreferencesRecord`, their queries, and the vocabularies `ACTIVITY_PROGRESS`, `GRADING_PROGRESS`, `MEMBER_STATUSES`, `CONTENT_ITEM_TYPES`, `CONTROL_ACTIONS`, `ATTEMPT_STATUSES`                                                                                                                    |
| `@interopkit/tool-integration`          | `AccessToken`, `CallOptions`, `Clock`, `Fetch`, `HttpRequest`, `HttpResponse`, `InteropkitError`, `JsonObject`, `JsonValue`, `Signer` of `@interopkit/core`: the types that its declarations name, exported here so that a program that installs this package imports them from here (`InteropkitError` is the base class of `LtiError`, exported as a value)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@interopkit/tool-integration/platform` | `prepareToolLaunch`, `handlePlatformRequest`, `readDeepLinkingResponse`, `readStartAssessment`, `buildRegistrationInitiation`, `buildToolRegistration`, `buildPlatformEndpoints`, `buildCapabilitiesScript`; `MessageInput` and its five types (`ResourceLinkInput`, `DeepLinkingRequestInput`, `SubmissionReviewInput`, `StartProctoringInput`, `EndAssessmentInput`) with `MessageInputBase`, `MessageServicesInput` and `DeepLinkingInputSettings`; `ToolRegistration`, `PlatformConfig`, `PlatformEndpoints`, `PlatformFrame`, `CapabilitiesScript`, `LaunchToCheck`; the ports `LaunchStore`, `Substitution`, `GradebookStore`, `RosterStore`, `GroupStore`, `PreferencesStore`, `AssessmentControl`, `RegistrationStore` with `RegistrationRefusal`, `RegistrationRefusalReason`, and `PlatformServices`, with `ServiceCaller`, `StorePage`, `StoredLineItem`, `StoredResult`, `ReceivedScore`, `StoreLineItemQuery`, `StoreResultQuery`, `StoreMemberQuery`, `StoreMemberPage`, `StoreGroupQuery`; `ReceivedDeepLinkingResponse`, `ReceivedStartAssessment`, `RegisteredTool`, `RegistrationGrant`; the options `PlatformOptions`, `PlatformLoginOptions`, `PlatformRequestOptions`, `PlatformDiscovery`, `ToolMessageOptions`, `RegistrationInitiationOptions` |
| `@interopkit/tool-integration/tool`     | `handleLogin`, `handleLaunch`, `serveToolJwks`, `buildDeepLinkingResponse`, `buildStartAssessmentPage`, `createServiceClient`, `advanceScoreTimestamp`, `readRegistrationInitiation`, `discoverPlatform`, `registerTool`, `buildPlatformRegistration`, `buildRegistrationClosePage`; `PlatformRegistration`, `LtiStore`, `LoginRecord`, `DeepLinkingResponseInput`, `StartAssessmentInput`, `RegistrationInitiation`, `ToolConfigurationInput`, `PlatformRegistrationInput`, `ServiceClient`, `GradesClient`, `MembersClient`, `GroupsClient`, `PreferencesClient`, `ControlClient`, `RegistrationClient`, `Page`, `MemberPage`, `TokenStore`; the options `ToolOptions`, `LtiLoginOptions`, `LtiLaunchOptions`, `ServeToolJwksOptions`, `ServiceClientOptions`, `DiscoverPlatformOptions`, `RegisterToolOptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Supported

Both roles have the launch of every message type, key sets, access tokens, the Assignment and Grade Services, Names and Role Provisioning, Context Groups, the AfA PNP Connector, Deep Linking, Proctoring Services and Dynamic Registration ([what is supported](https://interopkit.wakan.dev/_interopkit/tool-integration/supported/)).

## Documentation

| Page                                                                                                                                                                                                                                      | Gives                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Tool](https://interopkit.wakan.dev/_interopkit/tool-integration/tool/)                                                                                                                                                                   | The routes, the store, every check of a launch, the key set and its rotation, scores, the failure paths and the signals                                                                                                     |
| [Platform](https://interopkit.wakan.dev/_interopkit/tool-integration/platform/)                                                                                                                                                           | The same for the platform role                                                                                                                                                                                              |
| [Grades](https://interopkit.wakan.dev/_interopkit/tool-integration/grades/), [roster](https://interopkit.wakan.dev/_interopkit/tool-integration/roster/), [services](https://interopkit.wakan.dev/_interopkit/tool-integration/services/) | The Assignment and Grade Services; members, groups and the preferences record; the model of every service body                                                                                                              |
| [Deep Linking](https://interopkit.wakan.dev/_interopkit/tool-integration/deep-linking/)                                                                                                                                                   | The items and both roles                                                                                                                                                                                                    |
| [Proctoring](https://interopkit.wakan.dev/_interopkit/tool-integration/proctoring/)                                                                                                                                                       | The Start Assessment message and the Assessment Control Service in both roles                                                                                                                                               |
| [Registration](https://interopkit.wakan.dev/_interopkit/tool-integration/registration/)                                                                                                                                                   | Dynamic Registration in both roles                                                                                                                                                                                          |
| [Choosing](https://interopkit.wakan.dev/_interopkit/tool-integration/choosing/)                                                                                                                                                           | When the package fits, when another library fits better, and what each has that the package lacks                                                                                                                           |
| [Evidence](https://interopkit.wakan.dev/_interopkit/tool-integration/evidence/)                                                                                                                                                           | The examples and vocabularies of the specifications, tokens another library signs, tools of other authors (`@lti-tool/core`, `lti-core`, PyLTI1p3) launched from the platform role, Moodle in both roles, and four runtimes |
| [Performance](https://interopkit.wakan.dev/_interopkit/tool-integration/performance/)                                                                                                                                                     | The speed of the launch and of the pages of the services, the size of each entry point and the peak memory of each reader                                                                                                   |

## License

[Apache-2.0](https://github.com/interopkit/interopkit/blob/main/packages/tool-integration/LICENSE). Copyright Fariz Wakan. See [NOTICE](https://github.com/interopkit/interopkit/blob/main/packages/tool-integration/NOTICE).

LTI® is a trademark of 1EdTech® Consortium, Inc. (1edtech.org).
AccessForAll® is a trademark of 1EdTech® Consortium, Inc. (1edtech.org).
interopkit is not affiliated with, endorsed by or approved by 1EdTech Consortium, Inc.
