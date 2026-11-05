---
"@interopkit/tool-integration": major
---

LTI 1.3 for learning platforms and tools. The tool role is a tool that a platform launches: it answers the platform's login
with a cookie, and, when the platform names a storage frame, with the platform's browser storage as well, for a browser that does
not keep the cookie, whose pages ask the platform's capabilities for the frame to use; it
validates the launch of every message type, with the message types, the audiences and the algorithms that the
host accepts, binds it to the deployment and the target of its login, refuses the platform's authentication error and a form
above `maxFormBytes`, and verifies the LTI 1.1 migration claim with the host's secret. It signs with the `Signer` of each
registration, keeps the JWK Sets of other parties by the `Clock` of the host for `jwtVerify` of jose (`createJwksCache`: a set of up to 100 keys is fetched again past its lifetime, and for a missing `kid` at most once a refresh time), serves its key set with every key of a rotation (`serveToolJwks`), answers a Deep Linking request with the page that posts
the signed response (`buildDeepLinkingResponse`, which holds the items of the five types and of others to what the request accepts),
sends a proctored candidate back with the page that posts the signed Start Assessment message (`buildStartAssessmentPage`, which
returns the session data and holds the verified claims to the values that the platform sent), and calls the Assignment and
Grade Services with `createServiceClient`: the line items of a context in pages, created, read, replaced and deleted, their
results, and scores, with `advanceScoreTimestamp` for strictly later timestamps. It asks for the narrowest scope that a call
needs, keeps one access token of `@interopkit/core/oauth` for each scope until it is about to expire, shares it with the clients
of other processes through the host's `TokenStore` when one is given, by issuer, client, deployment and scope and never past its
expiry, sends it only to the
registration's service origins or to a public host, follows only `next` links of the same origin, and reads every answer within
`maxBytes` and `maxTokens` into its model; the same client reads the members of a context or a resource link in pages, with
their group enrollments, the message of the link and the link to the differences (Names and Role Provisioning 2.0), the groups
and group sets of a context (Context Groups 1.0), the record of a user for an activity (AfA PNP Connector 1.0), and the Assessment
Control Service of a proctored attempt, whose request it reads back against Proctoring Services 5.1 before it sends it, and the
tool's registration at its client configuration endpoint. A tool registers itself with a platform through Dynamic Registration in
steps: `readRegistrationInitiation`, `discoverPlatform`, which fetches no address of a private host and accepts the configuration only
below its issuer, `registerTool`, which sends the registration token only to the issuer's origin or the host's `registrationOrigins`,
`buildPlatformRegistration`, which makes the tool's record of the platform, and `buildRegistrationClosePage`. The platform role launches tools: `prepareToolLaunch` keeps a message of five types (a resource link
launch, a submission review request, a Deep Linking request whose data seals its settings and the host's data, a Start Proctoring message whose session data
seals the attempt, and an End Assessment message) in the host's `LaunchStore` for 300 seconds and starts the tool's login, and
`handlePlatformRequest` answers every request to the platform's origin: the tool's authentication request, with the `id_token`
of the kept message signed by the `Signer` of the platform's key set, or with the authentication error response, after the host's
`checkLaunch` of the request; the key set
with every key of a rotation; the token requests, whose stateless token grants the scopes that the request asks for, the
registration grants and a service offers; the storage page of the client-side login; and the Assignment and Grade Services over
the host's `GradebookStore`, which has the methods of what it supports and at least one, such as `keepScore` alone for a platform
that takes scores, offered in a claim, at the token endpoint and in their routes only when the store is given and has the method, with the
tool and its scopes checked again on every request, pages with `next` links, and the timestamp of each score for the store to
keep the latest. The members of a context over a `RosterStore`, its groups and group sets over a `GroupStore` and the preferences records over a
`PreferencesStore` are served and offered in the same way (group sets only when the store has `groupSets`), each store checked as the gradebook is, and the platform shares only what a
request asked for: the enrollments with `groups=true`, the message with a resource link, and the members of a record that `fields` names.
The Assessment Control Service over an `AssessmentControl` is offered in a Start Proctoring message with the actions that the host
names, and answers 404 for an attempt that the store does not give the tool or a user of another issuer.
`readDeepLinkingResponse` reads the form that a tool posts to the return URL of a Deep Linking request: it verifies the
tool's token as an assertion is verified, accepts its `nonce` once, opens the `data` that the request sealed with its user, its settings and
the host's own data, holds the items, each read by its type, to those settings and to `maxContentItems`, and returns the subject that
the host compares with its session.
`readStartAssessment` reads the Start Assessment message that a proctoring tool posts in the same way, opens the session data that
the Start Proctoring message sealed, holds the resource link and the attempt to it, and returns the subject that the host compares
with its session. With a `RegistrationStore`, the platform serves Dynamic Registration: `buildRegistrationInitiation` gives a tool's
initiation URL a registration token for one registration, the OpenID configuration lies below the issuer with the scopes of the
services that the platform offers, `/registration` spends the token before it reads the body, refuses an address of the tool that
names no public host or lies on an origin of the platform, and narrows the scopes before the store registers the tool, and
`/registration/{client}` reads and updates the calling tool's registration with a token of `lti-reg` when the store has `get` and `update`, which are optional; `buildToolRegistration` makes the
record of a reviewed tool. It substitutes the variables of LTI
Core Appendix B that the message answers and those that the host resolves, signs the LTI 1.1 migration claim with a secret that
it does not keep, opens what an earlier hint key sealed, and refuses an algorithm that the tool's registration does not list.
`buildCapabilitiesScript` answers `lti.capabilities` on the host's frame page. Handlers take an `HttpRequest` and return
an `HttpResponse` of `@interopkit/core/http`, with request bodies as bytes; stores, registrations, `fetch` and the clock are
ports, and each takes a `signal` that ends the caller's wait. It is not certified by 1EdTech.

The messages of both roles have one model. `LtiMessage` is what a platform sends and `handleLaunch` returns: a resource link
launch, a Deep Linking request with its ten settings, a submission review request, and the Start Proctoring and End Assessment
messages, with the user and the `actual_user` of an impersonation, the context, the organization, the platform instance, the
launch presentation, the LIS identifiers, the custom properties, the claims of the grade, roster, groups and preferences
services, the LTI 1.1 migration claim and every claim of the token as JSON. `ToolMessage` is what a tool sends: a Deep Linking
response and a Start Assessment message. The role and context type vocabularies of LTI Core Appendix A are exports, with
`canonicalizeRole` and `canonicalizeContextType` for the deprecated simple names and URNs, beside `SCOPES`, `MESSAGE_TYPES` and
`APPROVED_ALGORITHMS`. A token is verified with RS256, RS384, RS512, ES256, ES384 or ES512 and no other algorithm; its audiences
must be the tool and parties that the registration trusts, and a token with several audiences must name its authorized party.
`KeySet` is the signer and the public keys of one party.

The bodies of the services have one model too, in both roles. A line item (with `activityId`, `gradesReleased` and
`submissionReview`), a score, a result, the members of a context or a resource link with their messages and group enrollments,
the groups and group sets of a context, the five content items of Deep Linking with their extensions, the configuration of a
platform, the registration that a tool asks for and its acknowledgment, the request and the status of the Assessment Control
Service, and the record of the AfA PNP Connector, each with the filters of its request. A body that breaks its specification is a
`DataError` that names the path of the first invalid member. A date takes its time zone as `Z`, `+hh:mm`, `+hhmm` or `+hh`, and an empty optional address of a registration is read as absent.

Every function is named by what it does, with one verb for one meaning: a function that reads or writes a form that a standard defines is `read` or `write`, one that assembles plain data `build`, one that returns an object with behavior `create`, one that answers an HTTP request `handle`, a lookup `find` or `list`, and a predicate `is`. The time that `advanceScoreTimestamp` takes is `nowMs`, with the unit abbreviated as `timeoutMs` is.

`LtiError.reason` is a term of the exported union `LtiErrorReason`, so that a host can switch on it exhaustively. `RegistrationRefusal` is `{ reason, message }`: the `reason` is `invalid_client_metadata` or `invalid_redirect_uri`, named by `RegistrationRefusalReason`, and the route answers 400 with the store's reason and message. An option `clock` that is left out is `SYSTEM_CLOCK`, for the tool role and for the platform role. A form over `maxFormBytes` and a Deep Linking response over `maxContentItems` throw `LimitError` of `@interopkit/core`, which a host answers with 413; the services of the platform answer 413 for JSON over its levels or tokens, and an answer of a client over `maxTokens` is a `LimitError`. `LtiError` takes `ErrorOptions`, and one that reports another error carries it as its `cause`.

The custom properties are one type in every model and input: `custom` of `LtiMessage`, `LtiResourceLinkItem`, `SubmissionReview`, `MessageInput` and `ToolRegistration`, and `customParameters` of `ToolConfiguration` and `ToolMessageConfiguration`, are a `Readonly<Record<string, string>>`, and a property named `__proto__`, `constructor` or `prototype` is refused in all of them.

`prepareToolLaunch` is the one function that prepares a launch: it returns `{ url, storageUrl, storageTarget, toolFrame, allow? }`. The names of the two frames are fixed, `lti-storage` and `lti-tool`, and returned there, so that the host's page names its frames from the result; the options of `PlatformLoginOptions` and `PlatformRequestOptions` take no name of a frame, and `buildCapabilitiesScript()` takes no options.

One port has one name across the package: the lookup of a tool by its client identifier is `registration` in `PlatformLoginOptions`, `PlatformRequestOptions` and `ToolMessageOptions`, and the LTI 1.1 secret of a consumer key is `migrationSecret` in both roles. LTI 1.3 Core fixes the version claim at `1.3.0`, which `handleLaunch` checks, and any other value is `version-unsupported`.

Every options object of the tool role, of the platform role and of `createJwksCache` is read by a strict schema, so that a misspelled option is refused with a `DataError` that names it. `handleLogin`, `handleLaunch`, `buildDeepLinkingResponse` and `buildStartAssessmentPage` take `registration`, `clock`, `signal`, `store`, `jwks`, `fetch`, `otherMessageTypes`, `maxFormBytes` and `migrationSecret`, which one object may hold for all of them, and refuse any other property. `createServiceClient` takes these with `scopes`, `timeoutMs`, `maxBytes`, `maxTokens`, `pageLimit`, `refreshSkewSeconds` and `tokens`; `serveToolJwks` takes only `maxAgeSeconds`; `createJwksCache` takes only `fetch`, `clock`, `ttlSeconds`, `refreshSeconds` and `timeoutMs`. The message of a refused option is that of every other reader, such as `The options is invalid at maxFormBytes: expected a value of at least 1, found 0.`
