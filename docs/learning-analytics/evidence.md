# Evidence for learning-analytics

What shows that the package does what it says: the tables of the specifications, the published contexts, schemas and fixtures of
`caliper-spec`, the rules of the profiles, a sensor and an endpoint that run against each other, three engines of browsers and four runtimes. Each layer answers a
question that the one before cannot. The speed, the size and the peak memory are in [performance](performance.md). Caliper has no public
conformance suite for an endpoint and no open sensor or endpoint of 1.2 to run against, so the oracles are the 1EdTech documents.

```mermaid
flowchart LR
  tables["Tables of 1.2, the Library profile,<br/>the certification guide and 1.1<br/>pnpm test:spec"] --> model["Model and readers"]
  contexts["Published contexts<br/>pnpm test:corpus"] --> model
  fixtures["Fixtures of caliper-spec:<br/>1.2, 1.1, positive and negative<br/>pnpm test:corpus"] --> model
  schemas["Draft 4 schemas, 1.2 and 1.1<br/>pnpm test:corpus"] --> model
  model --> roundtrip["Sensor to endpoint in process<br/>pnpm test, pnpm test:corpus"]
  roundtrip --> example["Example: a sensor, an endpoint,<br/>an older sensor<br/>pnpm test"]
  example --> runtimes["Node.js, Deno, Bun, workerd<br/>pnpm compat:runtimes"]
  roundtrip --> browsers["The sensor in Chromium,<br/>Firefox and WebKit<br/>pnpm test:browser"]
  model --> rules["Mutation rules<br/>pnpm check:rules"]
```

| Layer         | Question                                                                                           | Where                                                                                                                  | Runs                  |
| ------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Tables        | Does the model have each class, property, action and vocabulary that the pages print?               | `entities.spec`, `events.spec`, `profiles.spec`, `versions.spec` tests                                                 | `pnpm test:spec`      |
| Examples      | Do the readers read every example that the pages print?                                             | The same files, through `readSpecPage`                                                                                 | `pnpm test:spec`      |
| Contexts      | Does a published context define every term that the model reads or writes?                          | `context.corpus`, `versions.corpus` tests                                                                              | `pnpm test:corpus`    |
| Fixtures      | Do the readers read the fixtures of `caliper-spec` and refuse the malformed ones?                    | `events.corpus`, `entities.corpus`, `profiles.corpus`, `endpoint.corpus`, `versions.corpus` tests                      | `pnpm test:corpus`    |
| Schemas       | Do the readers give the verdict of the draft 4 schemas on generated values and on values changed in one place? | `events.corpus`, `entities.corpus`, `versions.corpus` tests                                                  | `pnpm test:corpus`    |
| Profiles      | Does `validateEvent` agree with every row of the tables of section 3 and of the certification guide? | `profiles.spec`, `profiles.corpus`, `validate` tests, `scripts/caliper-rules.ts`                                      | `pnpm test:spec`      |
| Endpoint      | Does it answer each status in the order of its checks, and cost an unauthorized caller no parsing?   | `endpoint.test.ts`                                                                                                     | `pnpm test`           |
| Round trip    | Does what a sensor sends reach `accept` equal, in 1.2 and in 1.1?                                    | `endpoint.test.ts`, `roundtrip.corpus.test.ts`, `versions.corpus.test.ts`, `examples/learning-analytics/test`          | `pnpm test`, `pnpm test:corpus` |
| Rules         | Does a test fail when a rule that keeps the endpoint safe is removed from the code?                  | `scripts/rules/learning-analytics.ts`                                                                                  | `pnpm check:rules`    |
| Runtimes      | Does the example give the same results everywhere?                                                   | `compat/`                                                                                                              | `pnpm compat:runtimes`         |
| Browsers      | Does the path of a sensor run in the engines of the browsers, with the `uuid` built for them?        | `sensor.browser.test.ts`                                                                                               | `pnpm test:browser`   |

The model that the tables, the contexts and the fixtures are compared with has these counts, and a test fails when a table prints a
class, an action or a role that it lacks:

```ts
import { ACTIONS, CALIPER_VERSIONS, ENTITY_TYPES, EVENT_TYPES, ROLES } from "@interopkit/learning-analytics";

[EVENT_TYPES.length, ENTITY_TYPES.length, ACTIONS.length, ROLES.length]; // => [25, 76, 82, 57]
CALIPER_VERSIONS; // => ["1.2", "1.1"]
```

`pnpm test:spec` needs `pnpm spec-examples`, `pnpm caliper-tables`, `pnpm schemas` and `pnpm corpus` first; `pnpm test:corpus` needs
the last three; `pnpm bench` needs `pnpm corpus`.

## The sources

| Source                                                                                  | What it is                                                                                                   | Pinned by                                                          |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| The pages of Caliper 1.2, the Library Use Profile and the certification guide           | Tables of events, entities, actions, vocabularies and the rows of the profiles                              | `scripts/caliper-tables.lock.json`: the hash of the tables, not of the bytes |
| The page of Caliper 1.1                                                                 | The same, in its own layout, with the classes and properties that it deprecates                              | The same lock, with `layout: "v1p1"`                               |
| `1EdTech/caliper-spec` at `60f7cb7`                                                     | Fixtures of 1.2 (144 positive, 279 negative) and of 1.1 (129), the draft 4 schemas of both (110 and 77), the contexts of 1.2 and of 1.1 with its six extension profiles | `scripts/corpus.lock.json`: the hash of the archive |
| The published context of Caliper 1.2                                                    | The terms and their types                                                                                    | `scripts/schemas.lock.json`                                        |

The license of the repository does not allow redistribution, so `pnpm corpus` fetches it and nothing of it is committed.

## The fixtures

| Set                                 | What the readers do                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positive fixtures of 1.2            | Every event, entity and envelope reads and comes back as the fixture has it                                                                          |
| Negative fixtures of 1.2            | Every malformed event is refused, and every malformed entity but the four that `entities.corpus.test.ts` lists, which differ from a valid one only in the form of a number     |
| Fixtures of 1.1                     | Every document but one reads as 1.1 and comes back as the fixture has it. The one that fails names a `profile`, which 1.1 does not define, and a class of the sender's own context |
| Envelopes of 1.1                    | Every envelope is received with every item, with no finding, strict or not, and is answered 422 by an endpoint that reads 1.2 alone                   |
| Envelopes of 1.2 through a sensor   | `sendCaliper` posts each envelope from its read items, and `accept` receives the sensor, the time and every item equal to the fixture                |

The places where a source disagrees with another are in [spec-gaps](./spec-gaps.md), each pinned by a test.

## The schemas

`schema_1_2` and `schema_1_1` are draft 4 files that refer to one another by `id`; `scripts/schema-oracle.ts` reads a directory of them
into one validator, and `scripts/schema-arbitrary.ts` generates documents from them, narrowed by the tables where the schemas are
looser. For each class, 60 generated documents with a fixed seed must read, and the same documents with one change (a member
removed, retyped or replaced) must be refused whenever the schema refuses them. The schemas allow what the tables close, so the
readers are stricter, never looser: the one exception is the `@context` of a nested entity in 1.1, which the schema allows as a string or
a list and section 4.1 as an object too.

## The example

`examples/learning-analytics` is a sensor and an endpoint of a host. The sensor reports an attempt as Caliper 1.2 events and sends
them again after a failure that a resend can cure; the endpoint is `handleCaliperRequest` over a table of tokens and a store in
memory, and a `fetch` for a sender in the same process; an older sensor posts an envelope of Caliper 1.1 by hand. The tests and the
scenario show:

| What the scenario shows                                                                                              | Where                          |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| A 503 before the endpoint, then a send that is received, with the same identifiers and a later time                  | `scenario.test.ts`             |
| The attempt reported again arrives, and the endpoint holds each event once by its `id`                               | `endpoint.test.ts`             |
| The endpoint names the sender by its token, and never by the `sensor` of the envelope                                | `endpoint.test.ts`             |
| An envelope of 1.1 with a describe and an event is received into the same shape as one of 1.2                        | `endpoint.test.ts`             |
| An unknown token is 401, and an endpoint that reads 1.2 alone answers 422 to the envelope of 1.1                     | `endpoint.test.ts`             |
| An item that does not read is left out, and its findings carry the path inside the envelope                          | `endpoint.test.ts`             |

## Runtimes

`pnpm compat:runtimes` bundles the scenario with the packages as they ship and runs it on Node.js, Deno, Bun and workerd. The example uses web
standards alone, and its results are the same on each: the sends and their identifiers, what the endpoint holds and read of each
envelope, the versions it announces and its two refusals.

`pnpm test:browser` runs the path of a sensor in Chromium, Firefox and WebKit (`sensor.browser.test.ts`), where the `uuid` that
the package loads is its build for browsers: the identifiers equal those of Python's `uuid5`, `buildEvent` and `buildEntity` build
what the readers read back, `sendCaliper` posts to an endpoint that the page holds, which answers with the engine's own
`Response`, a redirect is refused and a call that is never answered ends at its time limit, and a value of 100,000 levels is
refused without exhausting the stack of the engine.

## Not included

| Not included                               | Why                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Certification of a sensor                  | 1EdTech certifies sensors per profile for members. The tables of the guide are read, and the docs say "implements"              |
| An open Caliper 1.2 endpoint or sensor     | None exists. The collector in `CaliperBootcamp` validates with the same schemas and needs Neo4j, so it would add no evidence      |
| A budget in time                           | The runners of CI have not sampled the benchmarks yet; the ratios hold on any machine                                            |
