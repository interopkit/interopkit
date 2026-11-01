---
"@interopkit/core": minor
---

The foundation of `@interopkit/tool-integration` and `@interopkit/learning-analytics`: `InteropkitError`, `DataError` and
`ServiceError`, the checks of arguments, a `Clock`, `requestService` and `callService`, the calls to a service over HTTP with
a deadline, a size limit of 65,536 bytes unless the call says otherwise, no redirects, any of GET, POST, PUT, DELETE and HEAD,
bodies as text or bytes, statuses that a call returns as values, and a `signal` that ends the caller's wait, and
`untilAborted`, which ends one caller's wait on work that several callers share. `@interopkit/core/http` holds the request
and the answer of a handler as plain data with bodies as bytes, `readText`, `readJson`, `readQuery` and `readForm`,
`jsonResponse`, and `negotiate`, which chooses a media type from `Accept`.
