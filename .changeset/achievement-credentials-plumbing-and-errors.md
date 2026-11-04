---
"@interopkit/achievement-credentials": major
---

A finding is an `Issue` of `@interopkit/core/checks`, which replaces `CredentialIssue`. The client of the Open Badges and CLR APIs makes its requests through `requestWithCredential` of core, and refuses a `baseUrl` with an empty query or fragment, as it refuses one with a query or a fragment.
