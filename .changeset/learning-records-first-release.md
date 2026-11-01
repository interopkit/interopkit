---
"@interopkit/learning-records": minor
---

The model of xAPI 2.0: a Statement and everything it holds, the vocabularies, and `StatementIssue`. `readStatement` reads a
value into the model for the rules of an LRS or of a Learning Record Provider (`role`), checks every property against the tables
of the standard and the rules between them, and returns a copy; it throws a `DataError` that names the path of the first error
and counts the others. `validateStatement` and `validateStatements` return every finding, with its path, rule, sentence and
severity, as data: identifiers, the voided verb, scores, the forms of IRIs, UUIDs, times, durations and language tags, the form of
each interaction's response patterns, and for a provider UTC times and what the LRS sets. `readStatementJson` parses the text of
a request within limits of size, depth and tokens, and refuses an object that names a property twice. `buildStatement` makes the
Statement of an event with the time in UTC, and checks it against the rules of a provider; `voidingStatement` makes the one that
voids another; `deriveStatementId` gives an event an id that a resend repeats; `formatDuration`, `parseDuration`,
`formatTimestamp` and `mboxSha1sum` write and read the durations, times and hashes of the standard. `sameStatement` compares two
Statements by the rules of immutability, and `formatStatement` returns a Statement as `ids`, `exact` or `canonical`.
`@interopkit/learning-records/attachments` writes and reads the `multipart/mixed` message of Statements and Attachment data, matched
by SHA-2 hash and read within limits of parts and bytes, and `@interopkit/learning-records/signing` signs a Statement over a
`Signer` of `@interopkit/core` with RS256, RS384 or RS512 and verifies the signature against the leaf of its `x5c` or a key, with
the equivalence of the payload.
