---
"@interopkit/competency-frameworks": major
---

`ImsxStatusInfo` is the `StatusInfo` of `@interopkit/core` with the codes of the binding, `StatusInfo<StatusCodeMinorValue>`.
`StatusCodeMinor` and `StatusCodeMinorField` are those of core, which also exports `STATUS_CODES_MAJOR` and `STATUS_SEVERITIES`:
this package no longer exports them, nor `StatusCodeMajor` and `StatusSeverity`. `STATUS_CODES_MINOR` and `StatusCodeMinorValue`
stay. The 401, 403 and 429 answers to a refusal of the host come from `buildRefusalResponse` of core, with the same codes and
headers; the default message of a 429 is core's.
