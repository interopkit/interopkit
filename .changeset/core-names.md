---
"@interopkit/core": major
---

Every function is named by what it does, with one verb for one meaning: `startAuthorization`, `readBearerToken`, `requestClientCredentialsToken`, `findExceededJsonLimit`, `describeIssue`, `buildJsonResponse`, `findLinkTarget`, `buildPageLinks`, `formatIssuePath`, `describeRefusal`, `readRetryAfterSeconds`, `createCryptoKeySigner`, `buildStatusInfoResponse` and `raceAbort`. A function that reads or writes a form that a standard defines is named `read` or `write`, one that assembles plain data `build`, one that returns an object with behavior `create`, one that answers an HTTP request `handle`, a lookup `find` or `list`, a predicate `is`, and no old name is kept as an alias.

Optional parameters come in one options object: `buildJsonResponse(status, body, { headers, type })`, `callPort(call, { signal })` and `raceAbort(promise, { signal })`, as every other call that waits takes its `signal`. `parseDateTime` throws a `DataError` for text that is not a date and time of RFC 3339, as every `parse` function does; `isDateTime` tells beforehand, and `JsonResponseOptions` is exported with `@interopkit/core/http`.

`Random` is an object with `uniform()`, as the random sources of `@assesskit/runtime` and `@measurekit/core` are, and `SYSTEM_RANDOM` is one, so that a host passes one source to every library. `checkArray` refuses an array with a hole, which `forEach`, `map` and `every` skip unseen. An option `clock` that is left out is `SYSTEM_CLOCK`, in `createKeyedCache`, `createTokenCache` and the calls of `@interopkit/core/oauth`; `checkClock` accepts none and `readClock` reads the clock of the system when it gets none.
