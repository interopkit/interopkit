# Building events

`buildEvent` writes the `@context` of an event and checks every property of it, `mintUrn` gives it an identifier that stays the
same when the event is reported again, and `caliperTime` writes its times. The classes that an event refers to are those of
the [model](./model.md).

```mermaid
flowchart LR
  host["Host: its own records"] -->|"parts that identify the event"| mint["mintUrn"]
  host -->|"epoch milliseconds"| time["caliperTime"]
  host -->|"actor, action, object"| build["buildEvent"]
  mint -->|"id"| build
  time -->|"eventTime"| build
  build -->|"CaliperEvent"| out["sendCaliper, or your own transport"]
  build -.->|"DataError at the first property that is not valid"| host
```

## Building an event

`buildEvent(input)` writes the `@context`, checks every property and returns a new event. The input is not changed, the result
shares no object with it, and its properties are always in the same order, so the same event always serializes to the same
bytes.

| Property    | Meaning                                                        | Default  |
| ----------- | -------------------------------------------------------------- | -------- |
| `id`        | A UUID URN, `urn:uuid:` and a UUID. Make it with `mintUrn`     | required |
| `type`      | The event type: one of the terms below                         | required |
| `profile`   | The profile that governs the event: one of the terms below     | required |
| `actor`     | The entity that acted                                          | required |
| `action`    | What the actor did: one of the terms below                     | required |
| `object`    | The entity that the actor acted on                             | required |
| `generated` | The entity that the action made, such as an attempt or a score | none     |
| `eventTime` | When it happened, as `caliperTime` writes it                   | required |
| `edApp`     | The absolute IRI of the application that the event happened in | required |

An event with a property that is not in this table is refused, so that nothing is dropped without notice. The entities of an
event are checked by the classes of the [model](./model.md): an entity with a property that its class does not have is refused.

| Term kind    | Terms that this version builds                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Event types  | `AssessmentEvent`, `AssessmentItemEvent`, `NavigationEvent`, `GradeEvent`                              |
| Profiles     | Any of `PROFILES`: the 15 profiles of Caliper 1.2 and the Library Use Profile                          |
| Actions      | Any of `ACTIONS`: the 80 actions of Appendix D and the two that the Library Use Profile adds           |
| Entity types | Any of `ENTITY_TYPES`, as the [model](./model.md) describes them, each as an object or as its IRI     |

The profile and the action are checked as terms, and not against the rows of the profile tables: `buildEvent` accepts a
`GradeEvent` with the `AssessmentProfile`. The caller builds the combinations that the profile tables list.

## Identifiers

`mintUrn(parts)` returns `urn:uuid:` and the name-based UUID of version 5 ([RFC 9562 section 5.5](https://www.rfc-editor.org/rfc/rfc9562#section-5.5))
of the JSON text of the parts. The same parts always give the same identifier, and parts that a plain join would confuse give
different ones.

```ts
import { mintUrn } from "@interopkit/learning-analytics";

mintUrn(["event", "attempt-1", "started"]); // => "urn:uuid:ce4d4096-7102-5f9f-8d5b-bb94689856e4"
mintUrn(["event", "attempt-1", "started"]) === mintUrn(["event", "attempt-1", "started"]); // => true
mintUrn(["event", "a", "1"]) === mintUrn(["event", "a1"]); // => false
```

| Rule      | Value                                                                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name      | The JSON text of the array, so `["event","a","1"]` and `["event","a1"]` are two names                                                                                                                                   |
| Namespace | `4bcd2e8b-df2f-56d9-b6c1-d17e5077c977`: the UUID of `https://github.com/assesskit/assesskit/tree/main/packages/player/src/caliper` in the URL namespace. It never changes, because changing it changes every identifier |
| Parts     | At least one string or finite number; a number that is not finite writes as `null`, so it is refused                                                                                                                    |
| Oracle    | `validation/caliper_ids.py` computes the UUIDs with Python's `uuid5`, and a test compares the library with them                                                                                                         |

Put into the parts everything that tells two events apart, such as the kind of event, the session or attempt, and the step,
and nothing that can change between two reports of the same event. The identifier is not an address that a server can
dereference (Caliper 1.2 section 4.2 says an IRI should be one).

## Times

`caliperTime(at, label)` writes epoch milliseconds as Caliper requires: `YYYY-MM-DDTHH:mm:ss.SSSZ`, in UTC, with
milliseconds. A fraction of a millisecond is cut. `label` names the time in the error message.

| Input                                       | Result                                                                |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `0` to `253402300799999`                    | The time, from `1970-01-01T00:00:00.000Z` to the end of the year 9999 |
| Anything else, including `NaN` and a string | `DataError`                                                           |

`checkIri(value, label)` throws `DataError` unless the value is an absolute IRI, which Caliper requires of every entity
(section 4.2). A host can use it on the parties it passes in.
