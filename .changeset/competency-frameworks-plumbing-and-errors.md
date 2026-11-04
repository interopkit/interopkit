---
"@interopkit/competency-frameworks": major
---

A finding is an `Issue` of `@interopkit/core/checks`, which replaces `CaseIssue`. The client makes its requests through `requestWithCredential` of core, and refuses a `baseUrl` with an empty query or fragment, as it refuses one with a query or a fragment.

An answer of the client over `maxTokens` or 128 levels, and a value that `convertCaseVersion` reads over 64 levels, throw `LimitError` of core.

`authorize` refuses a request with `{ allowed: false, reason, message? }`, whose `reason` is `unauthenticated`, `forbidden` or `too-many-requests`.
