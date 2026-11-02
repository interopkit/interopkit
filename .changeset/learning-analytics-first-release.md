---
"@interopkit/learning-analytics": minor
---

Caliper Analytics 1.2 events, entities and a sensor. The model has an interface for each of the 69 entities of Appendix B, the 2
of Appendix C and the 4 of the Library Use Profile, and the vocabularies of the appendices; `readEntity` reads an entity describe
from outside against its class, as an object or an IRI wherever Caliper allows an entity, and refuses what the tables do not
allow. `buildEvent` checks an event of the Assessment Profile or the Grading Profile and writes its `@context`; `mintUrn` makes the identifier of an event from the parts that identify it, so that reporting the same
thing again gives the same identifier; `caliperTime` and `checkIri` check what Caliper requires of a time and an entity.
`sendCaliper` posts the events in one envelope with a bearer token through `callService`: it follows no redirect, ends at
`timeoutMs`, and takes a `signal` that ends the caller's wait.
