---
"@interopkit/tool-integration": minor
---

LTI 1.3 for learning platforms and tools. The tool role is a tool that a platform launches: it answers the platform's login
with a cookie or with the platform's browser storage, whose pages ask the platform's capabilities for the frame to use; it
validates the launch of every message type, with the versions, the message types, the audiences and the algorithms that the
host accepts, binds it to the deployment and the target of its login, refuses the platform's authentication error and a form
above `maxFormBytes`, and verifies the LTI 1.1 migration claim with the host's secret. It signs with the `Signer` of each
registration, serves its key set with every key of a rotation (`serveToolJwks`), answers a Deep Linking request with the page that posts
the signed response (`createDeepLinkResponse`, which holds the items of the five types and of others to what the request accepts), and calls the Assignment and
Grade Services with `createServiceClient`: the line items of a context in pages, created, read, replaced and deleted, their
results, and scores, with `advanceScoreTimestamp` for strictly later timestamps. It asks for the narrowest scope that a call
needs, keeps one access token of `@interopkit/core/oauth` for each scope until it is about to expire, sends it only to the
registration's service origins or to a public host, follows only `next` links of the same origin, and reads every answer within
`maxBytes` and `maxTokens` into its model. The platform role launches tools: `ltiPlatformLogin` keeps a message of five types (a resource link
launch, a submission review request, a Deep Linking request whose data seals its settings and the host's data, a Start Proctoring message whose session data
seals the attempt, and an End Assessment message) in the host's `LaunchStore` for 300 seconds and starts the tool's login, and
`handlePlatformRequest` answers every request to the platform's origin: the tool's authentication request, with the `id_token`
of the kept message signed by the `Signer` of the platform's key set, or with the authentication error response; the key set
with every key of a rotation; the token requests, whose stateless token grants the scopes that the request asks for, the
registration grants and a service offers; the storage page of the client-side login; and the Assignment and Grade Services over
the host's `GradebookStore`, offered in a claim, at the token endpoint and in their routes only when the store is given, with the
tool and its scopes checked again on every request, pages with `next` links, and the timestamp of each score for the store to
keep the latest. `readDeepLinkingResponse` reads the form that a tool posts to the return URL of a Deep Linking request: it verifies the
tool's token as an assertion is verified, accepts its `nonce` once, opens the `data` that the request sealed with its settings and
the host's own data, and holds the items, each read by its type, to those settings and to `maxContentItems`. It substitutes the variables of LTI
Core Appendix B that the message answers and those that the host resolves, signs the LTI 1.1 migration claim with a secret that
it does not keep, opens what an earlier hint key sealed, and refuses an algorithm that the tool's registration does not list.
`buildCapabilitiesScript` answers `lti.capabilities` on the host's frame page. Handlers take an `HttpRequest` and return
an `HttpResponse` of `@interopkit/core/http`, with request bodies as bytes; stores, registrations, `fetch` and the clock are
ports, and each takes a `signal` that ends the caller's wait. It is not certified by 1EdTech.

The messages of both roles have one model. `LtiMessage` is what a platform sends and `ltiLaunch` returns: a resource link
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
`DataError` that names the path of the first invalid member.

