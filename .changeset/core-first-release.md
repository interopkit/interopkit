---
"@interopkit/core": minor
---

The foundation of `@interopkit/tool-integration` and `@interopkit/learning-analytics`: `InteropkitError`, `DataError` and
`ServiceError`, the checks of arguments, a `Clock`, `callService`, the call to a service over HTTP with a deadline, a size
limit of 65,536 bytes, no redirects and a `signal` that ends the caller's wait, and `untilAborted`, which ends one caller's
wait on work that several callers share.
