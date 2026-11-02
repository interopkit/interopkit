---
"@interopkit/tool-integration": minor
---

LTI 1.3 for learning platforms and tools. The tool role is a tool that a platform launches: it answers the platform's login
with a cookie or with the platform's browser storage, validates the launch, answers a Deep Linking request, requests access
tokens and publishes scores. The platform role launches tools: it starts their login, issues the `id_token`, publishes its key set,
issues access tokens, and serves the line item of a launch and receives its scores. Handlers take an `HttpRequest` and return
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
