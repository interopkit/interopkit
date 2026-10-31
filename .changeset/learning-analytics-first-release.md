---
"@interopkit/learning-analytics": minor
---

Caliper Analytics 1.2 events and a sensor. `buildEvent` checks an event of the Assessment Profile or the Grading Profile and
writes its `@context`; `mintUrn` makes the identifier of an event from the parts that identify it, so that reporting the same
thing again gives the same identifier; `caliperTime` and `checkIri` check what Caliper requires of a time and an entity.
`sendCaliper` posts the events in one envelope with a bearer token through `callService`: it follows no redirect, ends at
`timeoutMs`, and takes a `signal` that ends the caller's wait.
