# Supported Caliper constructs

What the package implements of Caliper 1.2 and of the Library Use Profile, by construct. The counts come from the tables of the
specification that the tests read: a test fails when a table has something that the model lacks.

```mermaid
flowchart LR
  spec["Caliper 1.2: 21 events, 69 entities,<br/>2 entities with no id, 80 actions, 15 profiles"] --> have["Built and read now"]
  spec --> next["Built in the next units"]
  lib["Library Use Profile: 3 events, 4 entities, 2 actions"] --> have
  have --> entityNode["Entities: all 75, and the generic Entity"]
  have --> eventNode["Events: all 24, and the generic Event, read and built"]
  have --> vocab["Vocabularies: actions, profiles, roles, statuses,<br/>LTI message types, identifier types, metrics"]
  have --> ctx["Contexts: one, a list that ends with Caliper's,<br/>and inline"]
  have --> prof["Profile rules: 91 rows, the General Profile,<br/>the certification guide, findings"]
  next --> later["The endpoint, version 1.1"]
```

| Construct                                                  | Built | Where                                           |
| ---------------------------------------------------------- | ----- | ----------------------------------------------- |
| Entities of Appendix B                                     | 69 of 69 | `readEntity`, `buildEntity`, `buildEvent`; [model](./model.md) |
| Entities with no `id` of Appendix C                        | 2 of 2   | Same                                            |
| Entities of the Library Use Profile                        | 4 of 4   | Same                                            |
| Entity as an object or as its IRI, anonymous entities      | Yes      | Same                                            |
| Blank node identifiers, `extensions`, `otherIdentifiers`   | Yes      | Same                                            |
| `@context` as one context, a list ending with Caliper's, inline | Yes | Same                                            |
| Vocabularies of Appendices D to J                          | Yes      | `ACTIONS`, `PROFILES`, `ROLES`, `STATUSES`, `LTI_MESSAGE_TYPES`, `SYSTEM_IDENTIFIER_TYPES`, `METRICS` |
| Events of Appendix A, and the generic `Event`              | 21 of 21 | `readEvent`, `buildEvent`; [model](./model.md), [building events](./build.md) |
| Events of the Library Use Profile                          | 3 of 3   | Same                                            |
| The actions, the actors and the objects that each event allows | Yes  | Same                                            |
| Event properties `target`, `referrer`, `group`, `membership`, `session`, `federatedSession`, `extensions` | Yes | Same        |
| `@context` as a list in `buildEvent`, and as terms defined inline | Yes | `buildEvent`, `buildEntity`              |
| The 91 rows of the profile tables, the General Profile, the Library Use Profile | Yes | `validateEvent`, `buildEvent`; [judging events](./validate.md) |
| The event conformance tables of the certification guide    | Yes      | Same                                            |
| The recommendations of the profiles (generated entity, properties of an attempt, a score, a result and a timeout session) | Yes | Same |
| Sensor: one envelope of events with a bearer token         | Yes      | `sendCaliper`; [sending events](./send.md)      |

```ts
import { ACTIONS, ENTITY_TYPES, EVENT_TYPES, PROFILES } from "@interopkit/learning-analytics";

ACTIONS.length; // => 82
EVENT_TYPES.length; // => 25
ENTITY_TYPES.length; // => 76
PROFILES.length; // => 16
```

## Not yet built

| What                                                                                                       | Why                                                              |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Entity describes and a mix of events and entities in `data` of an envelope                                 | Built with the transport                                         |
| Reading the configuration of an endpoint (section 6.2), `caliperMaximumPayloadSize`, splitting an envelope | Built with the transport                                         |
| The endpoint role: reading an envelope and answering 2xx, 400, 401, 415 and 422 (section 6)                | Built with the transport                                         |
| Caliper 1.1 at the endpoint                                                                                | Read, never written                                              |
| A send without a bearer token                                                                              | The code requires one; the specification recommends it           |
