---
"@interopkit/achievement-credentials": major
---

Every function is named by what it does, with one verb for one meaning: `buildCaseAlignment` (was `caseAlignment`), `summarizeCredential` (was `credentialSummary`), `selectNewerCredential` (was `newerCredential`) and `isSameCredential` (was `sameCredential`). A function that reads or writes a form that a standard defines is named `read` or `write`, one that assembles plain data `build`, one that returns an object with behavior `create`, one that answers an HTTP request `handle`, a lookup `find` or `list`, a predicate `is`, and no old name is kept as an alias.

`CredentialsClientConfig` is `CredentialsClientOptions`, as the options of every other client factory are named, and `ttlMilliseconds` of `issueStatusListCredential` is `ttlMs`, with the unit abbreviated as `timeoutMs` is.
