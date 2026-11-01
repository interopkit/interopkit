---
"@interopkit/learning-records": minor
---

The model of xAPI 2.0: a Statement and everything it holds, the vocabularies, and `StatementIssue`. `readStatement` reads a
value into the model for the rules of an LRS or of a Learning Record Provider (`role`), checks every property against the tables
of the standard and the rules between them, and returns a copy; it throws a `DataError` that names the path of the first error
and counts the others. `validateStatement` and `validateStatements` return every finding, with its path, rule, sentence and
severity, as data: identifiers, the voided verb, scores, the forms of IRIs, UUIDs, times, durations and language tags, the form of
each interaction's response patterns, and for a provider UTC times and what the LRS sets. `readStatementJson` parses the text of
a request within limits of size and depth, and refuses an object that names a property twice.
