---
"@interopkit/learning-analytics": minor
---

Caliper Analytics 1.2 events, entities, a sensor and an endpoint. The model has an interface for each of the 69 entities of
Appendix B, the 2 of Appendix C and the 4 of the Library Use Profile, and the vocabularies of the appendices; `readEntity` reads
an entity describe from outside against its class, as an object or an IRI wherever Caliper allows an entity, and refuses what the
tables do not allow. `readEvent` reads the 21 events of Appendix A and the 3 of the Library Use Profile with the actions and the
classes of entities that their tables allow; `buildEvent` and `buildEntity` write the `@context`, a list of contexts included, and
check the same rules; `mintUrn` makes the identifier of an event from the parts that identify it, so that reporting the same
thing again gives the same identifier; `caliperTime` and `checkIri` check what Caliper requires of a time and an entity.

`validateEvent` and `validateEntity` list findings with a severity: the shape that the readers check, then the rows of the profile
tables of section 3 (91 rows, the General Profile and the Library Use Profile) and of the event conformance tables of the
certification guide. What no table allows is an error and what only the guide allows is a warning, and so are the
recommendations of the profiles: the governing profile, the generated entity, the properties of an attempt, a score, a result and
the session of a timeout. A media location without `currentTime` is an error. `buildEvent` refuses an event that has an error,
and the findings stop at `maxFindings` (1,000).

`sendCaliper` posts events and entity describes, mixed, in one envelope through `callService`, with a bearer token when there is
one: it follows no redirect, ends at `timeoutMs`, refuses an envelope above `maxPayloadBytes` before any request, and takes a
`signal` that ends the caller's wait. `pingEndpoint` asks an endpoint for its configuration and says whether it is available, as
section 6.2 reads the answer.

`@interopkit/learning-analytics/endpoint` is the endpoint. `handleCaliperRequest` takes an `HttpRequest` and answers a POST in a
fixed order that costs a caller that is not authorized no parsing: the method (405), `authorize` (401), the media type (415), the
size (413), the JSON within its depth and tokens and the four fields of the envelope (400) and the version (422); it hands the
events and entities that read, with the principal that `authorize` named and the findings, to `accept`, and answers 200 with an
empty body. With `strict` an item with an error refuses the envelope. A GET answers the configuration. `readEnvelope` reads a
parsed envelope the same way. Every failure is a problem detail, and a failure of a port says nothing of its cause.
