---
"@interopkit/learning-analytics": major
---

Every function is named by what it does, with one verb for one meaning: `formatDateTime` (was `caliperTime`). A function that reads or writes a form that a standard defines is named `read` or `write`, one that assembles plain data `build`, one that returns an object with behavior `create`, one that answers an HTTP request `handle`, a lookup `find` or `list`, a predicate `is`, and no old name is kept as an alias.

`sendCaliper` and `pingEndpoint` read their options with one strict schema, as the endpoint already did, so that a misspelled option is refused with a `DataError` that names it where it passed unseen: they take `endpoint`, `token`, `fetch`, `sensor`, `sendTime`, `timeoutMs`, `maxPayloadBytes` and `signal`, which one object may hold for both, and refuse any other property. `pingEndpoint` takes a `CaliperSender` without its `sensor`, which a ping never sends, and reads the JSON of the answer with `readAnswerJson` of `@interopkit/core`, whose sentence says that the answer `nests more than 64 levels`. `DEFAULT_CALIPER_TIMEOUT_MS` is gone: the default is `DEFAULT_TIMEOUT_MS` of `@interopkit/core`, the same 10,000. `checkIri` is gone: the readers, `buildEvent` and `buildEntity` refuse an `id` that is not an IRI, the sensor's own check stays, and `isAbsoluteUri` of `@interopkit/core/checks` tells a host the same.

`readEnvelope(value, options)` takes no principal, which it only copied into its result, and returns the envelope without `principal`; `handleCaliperRequest` adds it from `authorize` before `accept`, whose `ReceivedEnvelope` is unchanged.
