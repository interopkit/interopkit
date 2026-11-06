# Performance of learning-analytics

What the benchmarks of `@interopkit/learning-analytics` time and hold to a budget in CI (`pnpm bench`), the size of each entry
point, and the heap of each reader of untrusted input at its worst input (`pnpm test`). The docs publish no measured time: it
differs on every machine.

```mermaid
flowchart LR
  speed["1,000 events and entities<br/>against the schemas<br/>pnpm bench"] --> time["Time and ratio budgets<br/>packages/learning-analytics/test/budgets.ts"]
  size["Each entry point alone<br/>pnpm test"] --> gzip["Gzip budget and the modules it may hold<br/>packages/learning-analytics/test/size.test.ts"]
  memory["Peak memory of each reader<br/>pnpm test"] --> heap["Heap of each case<br/>packages/learning-analytics/test/peak-memory.test.ts"]
```

## Speed

`pnpm bench` times the build that ships on 1,000 events and on 1,000 entity describes of the fixtures of `caliper-spec` that the
draft 4 schemas take (an envelope of 1.2 has 1,469,236 bytes), against those schemas and `JSON.parse` in the same run. The budget of a
ratio is between two samples of one run, so it holds on any machine, and the budget of a time holds for the class of the
runner.

| Benchmark                                      | Reference                               |
| ---------------------------------------------- | --------------------------------------- |
| `readEnvelope` of 1.2                          | the draft 4 schemas                     |
| `readEnvelope` of 1.2                          | `JSON.parse` of the text                |
| `validateEvent` over the events                | the draft 4 schemas                     |
| `readEntity` over 1,000 entities of 71 classes | the draft 4 schemas                     |
| `validateEntity` over the same                 | the draft 4 schemas                     |
| `readEnvelope` of 1.1                          | `schema_1_1`                            |
| `readEnvelope` of 1.1                          | `JSON.parse` of the text                |
| `buildEvent` of 1,000 events                   | the draft 4 schemas over what it builds |
| `buildEntity` of 1,000 entities                | the same                                |
| `sendCaliper` of the envelope                  | `JSON.stringify` of the envelope        |
| `handleCaliperRequest` of the envelope         | `JSON.parse` of the text                |
| `handleCaliperRequest` of the envelope         | the draft 4 schemas                     |

A ratio is twice the highest measured on the runner, whether the reference is a schema or the JSON, and a time five times the
fastest sample of the runner, each rounded up to one significant digit. The schemas of 1.1 try the
`oneOf` of every class at each level.

| Choice                                                                                                                                                                                                    | Against a build without it, alternated in one process                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| The reader of a time reads the fields of `YYYY-MM-DDTHH:mm:ss.SSSZ` by their places and the days of the month; the endpoint reads the items that `JSON.parse` made of the body without copying them again | `readEnvelope` takes about 0.75 of its time; every fixture of `caliper-spec`, in both versions, reads to the same value and findings |

What remains is the schemas of valibot, the copy of a host's value, and the counts of the text in `@interopkit/core`; the copy
and the refusal of the names of the prototype chain are timed in [core](../core/performance.md).

## Size

`size.test.ts` bundles each entry point alone with `scripts/entry-size.ts`: esbuild, minified, with every dependency inside. It
fails above the budget after gzip, or when an entry point holds a module that its budget does not list. Gzip is measured on
Node.js 22; other versions differ by up to 1 percent.

| Entry point                               |  Bytes |   Gzip | Budget | Holds, besides `@interopkit/core` and valibot                 |
| ----------------------------------------- | -----: | -----: | -----: | ------------------------------------------------------------- |
| `@interopkit/learning-analytics`          | 72,484 | 21,641 | 27,500 | `build`, `model`, `read`, `send`, `v1p1`, `validate`, uuid    |
| `@interopkit/learning-analytics/endpoint` | 66,215 | 18,818 | 24,000 | `model`, `read`, `v1p1`, `validate`; no sensor and no builder |

## Memory

Each reader of untrusted input runs on its worst input within its limits in a Node.js process of its own whose heap is
bounded (`test/peak-memory.test.ts`, with the readings in `test/peak-memory-readings.ts`): what the reading keeps alive at once
must fit, whenever V8 collects, so a regression fails and the load of a machine cannot. The heap of a case is twice the least in
which the reading ends on Node.js 22 and 24, rounded up to 16 MiB; `node scripts/peak-memory.ts learning-analytics` prints the least, in steps
of 8 MiB. A reading that kept an issue for each wrong value would pass the heap by far.

| Reader                                     | Worst input                                                                                           | Least heap | Heap of the test |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------: | ---------------: |
| `readEvent`, `readEntity`, `validateEvent` | An object that holds a list of a million wrong values                                                 |     32 MiB |           64 MiB |
| The same, as Caliper 1.1                   | The same list                                                                                         |     32 MiB |           64 MiB |
| `readEnvelope`                             | An envelope whose event holds the same list                                                           |     32 MiB |           64 MiB |
| `handleCaliperRequest`                     | An envelope of 1 MiB of events, of 1.2 and of 1.1                                                     |     16 MiB |           32 MiB |
| `handleCaliperRequest`                     | An event whose extensions have as many distinct keys as 1 MiB holds, the costliest body for its bytes |     24 MiB |           48 MiB |

The copy of a host's value is most of what the million values cost: `copyJson` of
`@interopkit/core` copies the list and names the place of a value only when it is not JSON. The endpoint reads what it parsed
without that copy.
