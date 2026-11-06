# Performance of selective-disclosure

What the benchmarks of the three roles of `@interopkit/selective-disclosure` time against Digital Bazaar's suite and hold to a
budget in CI (`pnpm bench`), and the size of the entry point (`pnpm test`). The docs publish no measured time: it differs on
every machine.

```mermaid
flowchart LR
  speed["addBaseProof, deriveProof and verify<br/>against Digital Bazaar's suite 3.4.1<br/>pnpm bench"] --> time["Ratio budgets<br/>packages/selective-disclosure/test/budgets.ts"]
  size["The entry point alone<br/>pnpm test"] --> gzip["Gzip budget and the modules it may hold<br/>packages/selective-disclosure/test/size.test.ts"]
```

## Speed

`pnpm bench` times the build that ships against Digital Bazaar's suite 3.4.1 in the same run, on a credential of
Verifiable Credentials 2.0 with 12 achievements, each a blank node, of which a disclosure reveals 8
(`packages/selective-disclosure/test/proofs.bench.ts`). A role takes at least 20 samples after a warm-up. The budget is its
fastest sample as a multiple of the fastest of Digital Bazaar's suite in the same run, so it holds on any machine: twice the
highest ratio measured in 12 runs of the `bench` job on the runner of CI, on 2026-11-04 and 2026-11-05, rounded up to one significant digit.

| Role           | Where the time goes                                                                         |
| -------------- | ------------------------------------------------------------------------------------------- |
| `addBaseProof` | Canonicalization in the primitives; Web Crypto signs the statements, as in Digital Bazaar's |
| `deriveProof`  | Canonicalization in the primitives, and the copy and the limits of the input                |
| `verify`       | Canonicalization in the primitives; Web Crypto checks the signatures at once                |

## Size

`size.test.ts` bundles the entry point alone with `scripts/entry-size.ts`: esbuild, minified, with every dependency inside. It
fails above the budget after gzip, 1.25 times the size measured rounded up to the next 500 bytes, or on a module that its budget
does not list. Gzip is measured on Node.js 22; other versions differ by up to 1 percent. Most of the weight is the JSON-LD
processing that comes with the primitives, `jsonld` and `rdf-canonize`.

| Entry point                        |   Bytes |   Gzip | Budget | Holds, besides `@interopkit/core` and valibot                                                                                                                                                                          |
| ---------------------------------- | ------: | -----: | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@interopkit/selective-disclosure` | 226,252 | 70,509 | 88,500 | `base`, `derive`, `document`, `keys`, `proof-value`, `suite`, `verify`; `@digitalbazaar/di-sd-primitives`, `jsonld`, `rdf-canonize` and their small dependencies; the curves and hashes of noble, `@scure/base`, cborg |
