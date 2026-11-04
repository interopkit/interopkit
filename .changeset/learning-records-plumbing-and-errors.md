---
"@interopkit/learning-records": major
---

A finding is an `Issue` of `@interopkit/core/checks`, which replaces `StatementIssue`, and a Timestamp is written by `formatDateTime` of `@interopkit/core/checks`, which replaces `formatTimestamp`; a time with an offset is `formatDateTime(parseDateTime(text))`. The client of an LRS makes its requests through `requestWithCredential` of core, reads the options of a call that carries only a `signal` with `readCallOptions` of core, which reads no other property, and names what is wrong with an `endpoint` in the message: not https, credentials, a query or a fragment, or no final slash. An error that a reader of an answer throws becomes a `DataError` that names the LRS, with the error as its `cause`.
