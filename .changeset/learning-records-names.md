---
"@interopkit/learning-records": major
---

Every function is named by what it does, with one verb for one meaning: `hashAttachment`, `isSameStatement`, `convertStatementVersion` and `buildVoidingStatement`. A function that reads or writes a form that a standard defines is named `read` or `write`, one that assembles plain data `build`, one that returns an object with behavior `create`, one that answers an HTTP request `handle`, a lookup `find` or `list`, a predicate `is`, and no old name is kept as an alias.

The options of `createLrsClient` are `LrsClientOptions`, as those of every other client factory are named. `parseDuration` throws a `DataError` for text that is not an ISO 8601 duration, as every `parse` function does, and `isDuration` is exported to tell beforehand.

`ContextActivities` is an interface whose four properties are documented, and the guide of the model names `XAPI_VERSIONS` and `STATEMENT_FORMATS`. An option `clock` of `handleLrsRequest` that is left out is `SYSTEM_CLOCK`.
