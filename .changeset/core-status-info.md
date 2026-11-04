---
"@interopkit/core": major
---

The `imsx_StatusInfo` of the services of 1EdTech is defined once. `StatusInfo`, `StatusCodeMinor` and `StatusCodeMinorField` take the
codes of a service as a type parameter, `StatusInfo<TMinor extends string = string>`, and `STATUS_CODES_MAJOR` and
`STATUS_SEVERITIES` are exported by the root. `buildRefusalResponse(refusal, codes, options)` of `@interopkit/core/http`
answers the refusal of a host's `authorize` with 401, 403 or 429, the code that a service gives each reason, `WWW-Authenticate`
and `Retry-After`, with `RefusalCodes` and `RefusalResponseOptions`.
