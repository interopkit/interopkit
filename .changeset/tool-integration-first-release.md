---
"@interopkit/tool-integration": minor
---

LTI 1.3 for learning platforms and tools. The tool role is a tool that a platform launches: it answers the platform's login
with a cookie or with the platform's browser storage, validates the launch, answers a Deep Linking request, requests access
tokens and publishes scores. The platform role launches tools: it starts their login, issues the `id_token`, publishes its key set,
issues access tokens, and serves the line item of a launch and receives its scores. Handlers take plain requests and answers; stores, registrations, `fetch` and the clock are
ports, and each takes a `signal` that ends the caller's wait. It is not certified by 1EdTech.
