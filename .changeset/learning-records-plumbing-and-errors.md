---
"@interopkit/learning-records": major
---

A finding is an `Issue` of `@interopkit/core/checks`, which replaces `StatementIssue`, and a Timestamp is written by `formatDateTime` of `@interopkit/core/checks`, which replaces `formatTimestamp`; a time with an offset is `formatDateTime(parseDateTime(text))`. The client of an LRS makes its requests through `requestWithCredential` of core, reads the options of a call that carries only a `signal` with `readCallOptions` of core, which reads no other property, and names what is wrong with an `endpoint` in the message: not https, credentials, a query or a fragment, or no final slash. An error that a reader of an answer throws becomes a `DataError` that names the LRS, with the error as its `cause`.

`LimitError` of `@interopkit/core` replaces `JsonLimitError` and `MultipartLimitError`, with `limit` named by the option, `maxBytes`, `maxDepth`, `maxTokens`, `maxParts`, `maxPartBytes`, `maxTotalBytes` or `maxHeaderBytes`, and `maximum`, its value; `JsonLimit` and `MultipartLimit` are gone. Depth is a limit as the others are, so the LRS answers 413 for JSON that nests deeper than `maxDepth`, where it answered 400, and a merge of a document as well.

`parseStatementJson`, with `ParseStatementJsonOptions`, is the name of what was `readStatementJson`: it gives JSON and no model, so it is a `parse` by the verb of the family. `access` refuses a request with `{ allowed: false, reason, message? }`, whose `reason` is `unauthenticated`, `forbidden` or `too-many-requests`.
