# Performance of achievement-credentials

What the hot paths of `@interopkit/achievement-credentials` cost, how much each entry point adds to a bundle, and the heap that each reader of untrusted input needs on its worst input. A budget holds each number and fails a gate of CI: `pnpm bench` for the time, `pnpm test` for the size and the heap. That the package does what it says is in [evidence](evidence.md).

```mermaid
flowchart LR
  speed["Every hot path against<br/>Digital Bazaar, the Interop Alliance,<br/>did-jwt-vc, the official schemas<br/>pnpm bench"] --> time["Time and ratio budgets<br/>packages/achievement-credentials/test/budgets.ts"]
  size["Each entry point alone<br/>pnpm test"] --> gzip["Gzip budget and the modules it may hold<br/>packages/achievement-credentials/test/size.test.ts"]
  memory["Peak memory of each reader<br/>pnpm test"] --> heap["Heap of each case<br/>packages/achievement-credentials/test/peak-memory.test.ts"]
```

## Speed

`pnpm bench` times the build that ships against a reference in the same run: the comparator that does the same work where one
is installable ([comparators](comparators.md)), and otherwise the least work of the same kind. `scripts/bench-rounds.ts` runs the
function and its reference in three rounds, the reference first in the first and the last, so that the load of a shared machine
falls on both, and the gate is the ratio of the fastest samples. The table gives the range of the ratios of the eight latest green runs of the runner of CI and
of one run on a laptop; a budget is five times the highest ratio measured on the runner of CI (the eight latest green runs) and on a laptop, rounded up to one significant digit, and holds on any machine.

| Benchmark | Reference | Ratio | Budget |
| --- | --- | ---: | ---: |
| `verifyCredential` of a JWS | `did-jwt-vc`, which checks the signature and the claims | 0.14–0.30 | 2    |
| `verifyCredential` of a CLR in a JWS that holds 10 JWS | `did-jwt-vc` of the 11 JWTs | 0.14–0.31 | 2    |
| `verifyCredential` with an `eddsa-rdfc-2022` proof | `@digitalbazaar/vc`, which checks the structure and the proof | 1.06–1.14 | 6   |
| the same | `@interop/verifier-core`, which also checks the status and the expiry | 1.03–1.11 | 6   |
| `addProof` with `eddsa-rdfc-2022` | `vc.issue` of `@digitalbazaar/vc` with its suite | 0.99–1.11 | 6   |
| `verifyProof` of `eddsa-rdfc-2022` | `vc.verifyCredential` of `@digitalbazaar/vc` | 0.67–1.22 | 7   |
| `verifyProof` of `ecdsa-rdfc-2019` | `@interop/verifier-core` | 0.90–0.93 | 5   |
| `verifyProof` of `Ed25519Signature2020`, `legacyProofs` | `@interop/verifier-core` | 1.04–1.09 | 6   |
| `verifyProof` of an `ecdsa-sd-2023` disclosure | `@digitalbazaar/vc` with Digital Bazaar's `ecdsa-sd-2023` suite | 0.95–1.02 | 6   |
| `readCredentialJwt` | `verifyCredential` of `did-jwt-vc` | 0.12–0.27 | 2   |
| `signCredentialJwt` with EdDSA | `createVerifiableCredentialJwt` of `did-jwt-vc` | 0.11–0.20 | 2    |
| `issueStatusListCredential` of 131,072 entries, Data Integrity | `@interop/vc-bitstring-status-list` and `jsigs.sign` | 0.94–1.17 | 6   |
| `verifyCredentialStatus` against that list, fetched each time | `checkStatus` of `@interop/vc-bitstring-status-list` | 1.07–1.57 | 8   |
| `readCredential` of a CLR of 20 credentials | the official schema of CLR 2.0 in `@cfworker/json-schema` | 0.15–0.18 | 0.9  |
| `validateCredential` of the same CLR | the same | 0.15–0.18 | 0.9  |
| `bakePng` of that CLR into an image of 256 KiB | `JSON.stringify` of the CLR | 14.8–17.4 | 90  |
| `readPng` of that image | `JSON.parse` of the CLR | 2.68–3.49 | 20  |
| `bakeSvg` of that CLR into an SVG of 140,000 characters | saxes over the SVG | 1.46–1.67 | 9   |
| `readSvg` of that SVG, which stops at the credential | saxes over all of it | 0.57–0.64 | 4    |
| `handleCredentialsRequest`, a page of 100 credentials | `JSON.stringify` of the page | 1.22–1.24 | 7   |
| `handleCredentialsRequest`, the upsert of that CLR | `JSON.parse` of its body | 5.09–6.86 | 40 |
| `handleRefreshRequest` of that CLR | `JSON.stringify` of it | 1.03–1.06 | 6   |

The keyed cache that the key resolver and the status lists share is `createKeyedCache` of `core`, timed with the other hot paths of
`core` ([signals](../core/signals.md)). The profiles named three hot paths that are written as they are for their speed; each
alternative was timed as a build of its own, alternated with the package, three runs of each, with identical outputs on every case
of the fixtures, on the vectors of the W3C and on millions of generated texts:

| Hot path | Written so | The alternative takes |
| --- | --- | --- |
| The CRC-32 of a PNG chunk | By the table of PNG 1.2 annex D | Eight steps for each byte: `readPng` of the CLR 201 µs against 91, `bakePng` 310 against 181 |
| The base64url of a JWS that is signed | By a table in `core` | A string of the bytes as arguments, and `btoa`: `signCredentialJwt` of a CLR of 20, with its credentials, 1.42 ms against 0.91 |
| The parts of a JWS that is read | Decoded in one reading | Three copies of the text first: `readCredentialJwt` of the CLR 231 µs against 215 |

Where a ratio is above parity, the package does work that the reference does not. `verifyProof` and `addProof` are the same
libraries of the Interop Alliance with a bound on canonicalization, and their 1.01 to 1.11 is the reading of the credential in the
model and its limits; each context is copied for each load, so that no caller can change what the loader keeps. `verifyCredentialStatus`
also reads the list credential in the model, counts its tokens and binds its key to the issuer. The upsert reads the CLR in the model
after `JSON.parse`; the baking of a PNG reads and copies the credential it bakes, and the reading of a PNG checks the CRC of its chunk.
No budget in time is set yet: it waits for the samples of the runner of CI.

## Size

`size.test.ts` bundles each entry point alone with `scripts/entry-size.ts`: esbuild, minified, with every dependency inside and a
chunk of its own for what a dynamic `import()` loads, which loads only when the code that imports it runs. It fails above the
budget after gzip, 1.25 times the size measured rounded up to the next 500 bytes, or on a module that its budget does not list.

Gzip is measured on Node.js 22; other versions of Node.js differ by up to 1 percent.

| Entry point | Bytes | Gzip | Budget | Holds, besides `@interopkit/core`, `model` and valibot |
| --- | ---: | ---: | ---: | --- |
| `@interopkit/achievement-credentials` | 67,396 | 21,513 | 26,500 | `read`, `issue`, `compare`, `@noble/hashes` |
| `/baking` | 93,090 | 28,245 | 35,000 | `read`, saxes |
| `/client` | 67,176 | 20,973 | 25,500 | `read` |
| `/keys` | 148,002 | 49,988 | 61,500 | jose, the DID drivers of the Interop Alliance and the curves of noble |
| `/jwt` | 78,424 | 25,106 | 31,000 | `read`, the internals of `keys`, jose |
| `/data-integrity` | 453,123 | 136,580 | 169,500 | `read`, `keys`, jose, jsonld and the cryptosuites of the Interop Alliance, `selective-disclosure` |
| `/status` | 98,204 | 32,256 | 39,500 | `read`, `keys`, `jwt`, jose; `data-integrity` on demand |
| `/refresh` | 16,130 | 5,737 | 7,000 | nothing else |
| `/verify` | 157,652 | 50,900 | 62,500 | `read`, `issue`, `compare`, `keys`, `jwt`, `status`, `refresh`, jose, `@cfworker/json-schema`; `data-integrity` on demand |
| `/provider` | 111,958 | 37,043 | 45,500 | `read`, `keys`, `jwt`, the internals of `verify`, jose; the rest of `verify` on demand |

A verifier of JWTs, a provider that does not verify and a reader of status lists load no JSON-LD; the DID drivers load only with
`createKeyResolver`.

## Memory

Each reader of untrusted input runs on its worst input within its limits in a Node.js process of its own whose heap is
bounded (`test/peak-memory.test.ts`, with the readings in `test/peak-memory-readings.ts`): what the reading keeps alive at once
must fit, whenever V8 collects, so a regression fails and the load of a machine cannot. The heap of a case is twice the least in
which the reading ends on Node.js 22 and 24, rounded up to 16 MiB; `node scripts/peak-memory.ts achievement-credentials` prints the least, in steps
of 8 MiB.

| Worst input | Reading | Least heap | Heap of the test |
| --- | --- | ---: | ---: |
| A JWS of 1 MiB of the most numbers, verified | `jwtNumbers` | 32 MiB | 64 MiB |
| A JWS of 1 MiB of the most empty objects, verified | `jwtObjects` | 72 MiB | 144 MiB |
| A JWS of 15 MiB of four million empty arrays, refused by its tokens | `v2Payload` | 40 MiB | 80 MiB |
| A PNG whose credential holds the most objects that `maxTokens` leaves | `bakingPng` | 40 MiB | 80 MiB |
| An SVG of 10 MiB whose credential is one string | `bakingSvg` | 56 MiB | 112 MiB |
| A status list within the fetch limit that inflates to 256 MiB | `status` | 24 MiB | 48 MiB |
| A CLR of 600 credentials whose refresh services answer 600,000 characters | `verify` | 32 MiB | 64 MiB |
| A list of 5,000 alike items, refused as a limit of canonicalization | `dataIntegrity` | 64 MiB | 128 MiB |
| A body at the limits of the provider of the most objects | `provider` | 56 MiB | 112 MiB |
| An Open Badges 2.0 document of a million wrong values | `v2` | 56 MiB | 112 MiB |

The services of the CLR sign their answers when they are asked, and that signing falls in the reading. Without their bounds, the
CLR raised the peak by 174–264 MiB, the list of 5,000 items by 800 MiB, the Open Badges 2.0 document by 1 GB, and parsing the payload
of 15 MiB by 354 MiB.
