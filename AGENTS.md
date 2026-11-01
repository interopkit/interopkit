# AGENTS.md

Conventions for people and coding agents working in this repository. Read this before changing anything. Most rules are
enforced by `pnpm lint` (Biome and cspell), `pnpm check:standards`, `pnpm check:rules`, `pnpm typecheck`, `pnpm knip` and
`pnpm docs:api`; the rest are checked in review.

interopkit is a toolkit for learning-platform interoperability in JavaScript and TypeScript, in one repository:
`@interopkit/core` is the shared foundation, `@interopkit/tool-integration` implements LTI 1.3 in both roles, and
`@interopkit/learning-analytics` implements Caliper Analytics 1.2, and `@interopkit/competency-frameworks` implements the
CASE model and its readers.

```mermaid
flowchart BT
  core["@interopkit/core<br/>errors, checks, clock, service, http,<br/>signer, oauth"]
  proto["tool-integration: protocol<br/>claims, jwt, key sets, pages"]
  tool["tool-integration: tool"]
  plat["tool-integration: platform"]
  la["learning-analytics"]
  cf["competency-frameworks<br/>model, read, version"]
  proto --> core
  tool --> proto
  plat --> proto
  la --> core
  cf --> core
  gates["pnpm lint, check:standards, check:rules,<br/>typecheck, test, knip"] --> merge["Merge"]
```

## Terms

Use these words with these meanings in code, comments and docs.

| Term         | Meaning                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| platform     | The system that launches tools and keeps the grades: a learning management system. In code, the platform role                   |
| tool         | The system that a platform launches. In code, the tool role                                                                     |
| launch       | One start of a tool by a platform: a login request, an authentication response and an `id_token` with the claims of the message |
| registration | What a platform and a tool know of each other: issuer, client id, deployment and the addresses of their endpoints               |
| resource     | What a launch is for, in the host's terms: a string that is signed into the hint and handed back with a score                   |
| line item    | A column of the gradebook of a context; a tool posts scores to it                                                               |
| score        | The grade of one user for one line item, with its progress and a timestamp                                                      |
| port         | An interface that a package defines for what it needs from a host: a store, a lookup, a `fetch`, a `Clock`                      |
| host         | The application that uses the packages and supplies the ports                                                                   |
| event        | A Caliper event: an actor, an action on an object, and the time                                                                 |
| sensor       | The part of a system that builds events and sends them in an envelope to an endpoint                                            |
| endpoint     | The service that receives the envelopes                                                                                         |
| deadline     | The time a call to a service may take, `timeoutMs`                                                                              |
| framework    | A CASE competency framework, held as a package: one document with its items, associations, definitions and rubrics              |
| finding      | A `CaseIssue` of a reader: where, which rule, what is wrong, and whether it is an error or a warning                            |

## Layout

| Path                                 | Holds                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `packages/core/`                     | The shared foundation                                                                               |
| `packages/core/src/errors.ts`        | `InteropkitError`, `DataError`, `ServiceError`                                                      |
| `packages/core/src/checks.ts`        | Checks of one value and the valibot side, which `@interopkit/core/checks` exports                   |
| `packages/core/src/formats.ts`       | `isDate`, `parseDateTime`, `isUuid`, `isAbsoluteUri` and their schemas; `checks.ts` exports them    |
| `packages/core/src/json.ts`          | `JsonValue`, `copyJson`, `MAX_JSON_DEPTH`; `checks.ts` exports them                                 |
| `packages/core/src/clock.ts`         | `Clock`, `SYSTEM_CLOCK`, `readClock`, `checkClock`                                                  |
| `packages/core/src/call-options.ts`  | `CallOptions`, the `signal` of every call that waits on I/O                                         |
| `packages/core/src/service.ts`       | `Fetch`, `ServiceCall`, `requestService`, `callService`, `DEFAULT_TIMEOUT_MS`                       |
| `packages/core/src/http/`            | The request and answer types and their helpers, which `@interopkit/core/http` exports               |
| `packages/core/src/signer/`          | `Signer`, `signerFromCryptoKey`, `signCompactJws`                                                   |
| `packages/core/src/random.ts`        | `Random`, `SYSTEM_RANDOM`                                                                           |
| `packages/core/src/oauth/`           | The OAuth 2.0 clients and the token cache, which `@interopkit/core/oauth` exports                   |
| `packages/core/src/until-aborted.ts` | `untilAborted`, which ends a wait when a signal aborts                                              |
| `packages/tool-integration/`         | LTI 1.3: `errors.ts`, `protocol/`, `tool/`, `platform/`                                             |
| `packages/learning-analytics/`       | Caliper 1.2: `model/`, `build/`, `send/`                                                            |
| `packages/competency-frameworks/`    | CASE 1.1 and 1.0: `model/`, `read/`, `version/`                                                     |
| `packages/<name>/test/`              | `<module>.test.ts` per module; `.fuzz`, `.corpus`, `.spec` or `.browser` before `.test.ts`          |
| `docs/<package>/`                    | The guides of each package, one per module; TypeDoc publishes them with the API reference           |
| `examples/<package>/`                | Runnable examples, each a package of its own; the `test/` of an example runs it                     |
| `compat/`                            | The scenarios of the examples on each runtime                                                       |
| `scripts/`                           | The standards and mutation checks, pinned downloads, and the oracle and generators that tests share |
| `validation/`                        | Python scripts that write fixtures                                                                  |
| `biome/`                             | Biome GritQL plugins                                                                                |

## Commands

| Command                                             | Does                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                      | Installs the dependencies and the git hooks                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm lint`                                         | Biome and cspell; `pnpm format` fixes formatting                                                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm check:standards`                              | The rules of the engineering standards that a tool can check; `node scripts/check-standards.ts <path>...` reports only the files below the paths                                                                                                                                                                                                                                                                                             |
| `pnpm check:rules`                                  | Removes each rule of `scripts/check-rules.ts` from a scratch copy and runs its test, which must fail; a rule with `browser: true` runs its test in Chromium (`BROWSERS=chromium` limits any browser run to one engine); `node scripts/check-rules.ts <path>...` runs only the rules of the files below the paths                                                                                                                             |
| `pnpm typecheck`                                    | `tsc` over every package and the tooling                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm test`                                         | Vitest, offline; `pnpm test:coverage` adds the coverage floor of each package                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm test:browser`                                 | The browser tests in Chromium, Firefox and WebKit; run `pnpm exec playwright install` first. The Firefox of Playwright does not start on some macOS versions (it did not on macOS 27): run the suite in the container `mcr.microsoft.com/playwright` of the pinned Playwright release, with `--cpus=2` and `--ipc=host`, from a copy of the repository (`pnpm install` installs the git hooks only in a git clone, and skips them in a copy) |
| `pnpm knip`                                         | Unused files, exports and dependencies                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm build`                                        | `tsc -b` after deleting `dist/`, so that no stale output ships                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm check:packages`                               | Builds, then publint and Are the Types Wrong on the packed packages                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm check:licenses`                               | Every production dependency has an allowed license                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm check:audit`                                  | `pnpm audit` at high severity                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm compat`                                       | The scenarios of the examples on Node.js, Deno, Bun and workerd; run `pnpm build` first, and install Deno and Bun or name the runtimes: `pnpm compat node workerd`                                                                                                                                                                                                                                                                           |
| `pnpm docs:api`                                     | Builds, then TypeDoc into `docs/api`, which reads the packages through their `dist`; fails on undocumented exports                                                                                                                                                                                                                                                                                                                           |
| `pnpm corpus`, `pnpm schemas`, `pnpm spec-examples` | Download the pinned repositories, files and specification examples that tests read into `.cache/`; `pnpm corpus:pin`, `pnpm schemas:pin` and `pnpm spec-examples:pin` write new hashes. `pnpm test:spec` runs the tests that read the examples                                                                                                                                                                                               |

Run all of them before finishing a change. Development needs Node.js 22.18+ and pnpm 12. The scripts in `scripts/` are
TypeScript that Node runs directly, so their relative imports end in `.ts`. On a shared machine run Vitest with
`--maxWorkers=2` and containers with `--cpus=2`.

## Releases

Changesets version and publish the packages, each on its own version. A release has one changeset per package in
`.changeset/`; changes made before the release extend it. To release, a pull request from a `changeset-release/` branch
runs `pnpm changeset version`, which bumps the versions, writes `CHANGELOG.md` and consumes the changesets. After it is
merged, the maintainer runs the Release workflow by hand: it builds and publishes the versions not yet on npm with
provenance. No workflow opens pull requests, and Dependabot version updates are off. Changesets, docs and TSDoc describe
current behavior only, and never how it came to be.

## Boundaries

- interopkit owns the messages between a platform and a tool, the gradebook protocol, the Caliper event model, sensor and
  endpoint, and the CASE model with its readers. It does not own what a launched tool shows, what a score means, which
  delivery event becomes which Caliper event, QTI content, or databases, servers, sessions and accounts. Those belong to the
  tool, to assesskit and measurekit, to the adapter of each product and to the host.
- Packages of different families never import each other. interopkit defines ports (a store, a lookup, a `Fetch`, a `Clock`)
  or speaks an open standard, and an adapter to another family lives in the examples of that family or in the host. Names of
  QTI (`ItemKey`, `LtiLink`) never appear in interopkit.
- The packages use no platform API outside web standards: no `node:*`, no `process`, no DOM, and `fetch` appears only as an
  option that the caller passes. They run in Node.js, browsers, Deno, Bun and Cloudflare Workers. The `lib` of every
  `tsconfig` is `ES2023` and `WebWorker`, and `types` is empty, so `tsc` fails on a platform API.

## Dependencies

- A package imports only what its row in the diagram above allows. Biome enforces the rows for `core`, and for the folders
  of `tool-integration`: `protocol/` imports neither `tool/` nor `platform/`, and `tool/` and `platform/` never import each
  other. In `competency-frameworks`, `model/` imports neither `read/` nor `version/`, and those two never import each other.
  Imports never form cycles.
- A module imports another module of its package only through that module's `index.ts` (its public API) or its `internal.ts`
  (what the package's other modules and its tests share and the package does not export), never by a deep file path. A file
  directly in `src/`, such as `errors.ts` and `checks.ts`, is not in a module. `pnpm check:standards` enforces it.
- `internal.ts` cannot cross packages, so everything the packages share is a public export of `core`, covered by SemVer.
- Runtime dependencies are listed in the `package.json` of the package that loads them, pinned to an exact version at least
  two weeks old, and recorded in `SECURITY.md` with their reason and license. `pnpm-workspace.yaml` sets
  `minimumReleaseAge` so that an install cannot pick a younger version.
- Generic concerns use mature libraries: `jose` for JOSE, `valibot` for schemas, `uuid` for name-based UUIDs, `oauth4webapi` for
  OAuth 2.0 clients. Hand-written
  code is for domain logic that no library does correctly, with the reason in the guide of the module.
- Candidates that were compared and not adopted may be development dependencies, as counterparties in tests.
  `@cfworker/json-schema` is a development dependency of the repository, for `scripts/schema-oracle.ts`: the validator that tests
  run the published JSON schemas of a standard through.

## Deviations from the standards

Where the code departs from `STANDARDS.md`, with the reason.

| Deviation                                                                                  | Why                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The randomness of `state`, `nonce`, `jti` and hints is not injected                        | A source that a host or a test could replace could make secrets predictable; tests observe the values in the store instead                           |
| `custom` is a `Map` in the tool role and a record in the platform role                     | The tool role reads claim names from a token, `__proto__` among them, and the platform role writes what its host gave it                             |
| `tool-integration` signs with a `CryptoKey` through `jose`, not a `Signer`                 | Its registrations hold `CryptoKey`s; a `Signer` replaces them when its token calls move onto `core/oauth`                                            |
| Some functions are named for what they serve, such as `platformJwks` and `agsScores`       | They are the handlers of an endpoint, and the specifications name the endpoint; a verb would not say which one                                       |
| `ltiLaunch` throws an `LtiError` for a refused launch, and returns a page or a launch      | A refusal needs a reason and an HTTP status for the route; tell the results apart with `"status" in result`                                          |
| `toCaseVersion` reads the structure that it converts and not every property that it copies | `readPackage` and `readEntity` check the properties; the conversion reports the forms that 1.0 refuses, and it cannot tell the kind of a lone entity |
| The strings of the three small pages are in English and not in a catalog                   | A person sees them only when the login fails; a host that needs another language builds its own page from the same script                            |

## Naming

- Files: kebab-case. One concept per file, named after it. Group files in folders by module. No `utils`, `helpers` or `misc`.
- Values and functions: camelCase. Module-level constant data: SCREAMING_SNAKE. Types: PascalCase. Type parameters: `T` or `T`
  plus a name.
- No package, folder or brand name holds a specification name: the packages are `tool-integration`,
  `learning-analytics` and `competency-frameworks`, and `pnpm check:standards` fails on `lti` or `caliper` in one. Modules and functions use the names descriptively
  (`ltiLaunch`, `CaliperEvent`).
- Function options are `<Name>Options`. Labels are string unions in kebab-case (`"key-unknown"`).
- An error has a kebab-case `reason` where a caller must branch on it, and a `status` where it maps to HTTP.
- The names of the properties of a specification (`CFItems`, `imsx_codeMajor`) are kept as it writes them: the folders and
  files that define them are listed in the `useNamingConvention` override of `biome.json`.
- A vocabulary is a `const` tuple, its type is derived from it and its schema is `v.picklist` of it.
- A finding is a `Finding` of `core` (`path`, `rule`, `message`), extended by a package for its own fields. The `message` reads
  after the path and does not hold it; the rules are those that `findingsOf` names and those that a table of the guide lists.

## Code

- TypeScript strict, ESM, named exports only, `.js` extensions in relative imports of `src/`, `import type` for types.
- No `as` casts except where untyped data enters and is validated next. No non-null assertions.
- Entry points validate their input deeply and throw `DataError` with a full sentence that says what is wrong and what is
  expected, e.g. `The option timeoutMs must be a positive integer, found 0.` Input may come from plain JavaScript or JSON, so
  every argument is checked once, where the public function reads it, with a check of `@interopkit/core/checks`. An option's
  label is `The option <name>`. Inner functions trust their callers. JSON and objects that a host passes in are read with a
  valibot schema named `<name>Schema` and `parseWith`, which names the path of the first issue.
- Expected outcomes that a caller must handle are values in the result. Invalid input and broken invariants throw `DataError`.
  A failed call to a service is a `ServiceError` with its `status` and `body`.
- Anything that waits on I/O is async and takes `signal` of `CallOptions`, which ends that caller's wait. Work that several
  callers share, such as a key set fetch, runs to its own timeout and takes no caller's signal. Every port receives the
  signal.
- Every call to a service goes through `requestService`, or `callService`, which decodes its text: `redirect` is `"manual"`,
  any 3xx is an error, an answer has at most `maxBytes`, 65,536 by default, and every wait is raced against the deadline.
- A handler takes an `HttpRequest` and returns an `HttpResponse` of `@interopkit/core/http`, checks the request with
  `checkHttpRequest` at its entry, and reads the body with `readText`, `readJson` or `readForm`. No package defines its own
  request or answer type.
- Signing takes a `Signer` of `@interopkit/core`, never a key, so that a key in a KMS or an HSM works. A pick at random takes a
  `Random`.
- Never use `Math.random`, read a clock, or reach for `fetch`. Take a `Clock`, a random source or a `Fetch` from the caller.
  `pnpm lint` fails on `Math.random` and clock reads in `packages/*/src`; only `core/src/clock.ts` reads the system time.
- A number with a meaning is a named constant with its unit and source.
- No speculative options, abstractions or modules. Add a method only when a real use needs it, with its validation.
- No dead code, no compatibility paths, no workarounds. Before 1.0 there is no backward compatibility.

## Comments and docs

- Every export has a TSDoc comment that starts with one sentence: a noun phrase for a type or a constant, a third-person
  verb phrase for a function ("Returns ...", "Builds ..."), a short phrase for a property. A function adds `@param`,
  `@returns` and `@throws`, an option adds `@defaultValue`, a longer explanation goes under `@remarks`, and a specification
  is cited with `@see {@link url | name}`. A comment carries no history, no section sign and no code of a review or a
  ticket.
- `//` comments only explain why something non-obvious is done: an ambiguity of a specification, a trap, an invariant. No
  commented-out code.
- US English. Docs state facts in short sentences; prefer a table or list to prose. Code samples are complete: they show their
  imports and hold no TypeScript syntax, so that they run as they are. A guide gives the result of a sample as
  `// => result`, and `runGuideSamples` of `scripts/guide-samples.ts` runs the samples of the README and the guides in a test
  of the package and fails on a result that differs; `typecheckGuideSamples` compiles them under `strict`. What a call throws goes into a table of errors, not into a sample. No
  marketing language, emojis or filler.
- Visualization comes first, then tables, then short prose. Every README, `CONTRIBUTING.md` and guide opens with a Mermaid
  diagram of the architecture, the flow or the states that it describes (`pnpm check:standards` fails without one). GitHub
  renders the diagrams, and the Mermaid plugin of TypeDoc renders them on the docs site (`typedoc.json` pins the version of
  Mermaid that the site loads).
- Each guide has the diagram, a quick start that runs, the options with their defaults, the limits with their values, the
  errors with what to do about them, what is not included and why, and the differences from the references.
- Each document has one purpose: `README.md` for users, `docs/<package>/` for guides, `CONTRIBUTING.md` for the contribution
  process, `AGENTS.md` for conventions, `SECURITY.md` for deployment security.

## Evidence and tests

- A test title is a plain sentence about behavior, such as `it("refuses a redirect that the call does not follow")`. It
  carries no identifier of a row, a unit or a clause.
- Completeness comes from the specifications, not from a list that the repository keeps: tests derive what to cover from the
  published examples, schemas and tables, and fail when something is missing.
- One verb, one meaning: `read<X>(value, options?)` takes untrusted data into the model and throws `DataError` on invalid input;
  `validate<X>(value, options?)` judges a value and returns its findings, with their severity, as data; `check<X>` in `core`
  asserts one value and throws. Nothing named `check*` returns findings.
- A reader of data that has published JSON schemas is compared with them in a `*.corpus.test.ts` through
  `scripts/schema-oracle.ts` and `scripts/schema-arbitrary.ts`: its classes and properties are derived from the schemas, and
  generated values and values with one change get the verdict of the schemas. Each difference is in `spec-gaps.md` and pinned
  by a test.
- The examples that a specification prints are read in a `*.spec.test.ts` with `readSpecPage`; one that is not conformant is
  pinned with its findings and recorded in `spec-gaps.md`.
- Expected values come from an oracle, never from the code under test: the specification's own statements and worked
  examples, an independent implementation, or a script in `validation/`. Typed by hand only for edge cases small enough to
  derive exactly.
- A failure path of a port or a store is a test, written before the code it guards: it fails, it hangs, it is called again,
  and what it may call back.
- A rule that keeps a request from being forged, replayed or redirected has an entry in `scripts/check-rules.ts`. Replacing
  `find` with `replace` in `file` must make its test fail; `pnpm check:rules` proves it on a scratch copy, and a test checks
  that every entry still matches its file. So does each behavior of a reader or a converter that refuses or changes a value.
- Every public function has a test of input of other types, as JavaScript or JSON pass it: `null` options and arguments, a
  string for a number, an object for an array. Pass such input with `JSON.parse`, not a cast.
- Properties that hold for any input are tested with fast-check, with a fixed seed and a bounded number of runs. Every parser
  and decoder is fuzzed.
- Tests wait for events, never for time: a deadline test uses a short `timeoutMs` and waits for the rejection. No retries, no
  sleeps, no loosened assertions.
- Each package has a coverage floor in `vitest.config.ts`; a file `*.browser.test.ts` runs in the browsers, a file
  `*.corpus.test.ts` reads the downloaded schemas and repositories, and a file `*.spec.test.ts` the downloaded examples.
- Fixtures are never typed by hand when an oracle can write them, and a downloaded specification file is never committed.

## Where things go

- A construct of a specification: its test, and a line of the `supported.md` of the package when what is supported changes.
- A module of a package: a folder in `src/` with `index.ts`, `internal.ts` where other modules or the tests need more, a
  subpath in `package.json` `exports`, `typedoc.json` and `knip.json` when the host imports it, the same subpath in the
  `paths` of the `tsconfig` of each package or example that imports it, a test file, a guide in `docs/`, import rules in
  `biome.json`, and a row in the API table of the README of the package.
- A check shared by packages: `packages/core/src/checks.ts`, or a file that it re-exports. Code that two packages need goes in
  `core`; code used once stays where it is used.
- A place where the specifications contradict themselves or are silent: the resolution in the `spec-gaps.md` of the package,
  a test, and a mention in the guide of the module.
- A finding rule of a reader: a check in `read/`, a row of the rules table of the model guide, and a test; a rule that keeps a
  value from being returned also has an entry in `scripts/check-rules.ts`.
- A pinned file: an entry in `scripts/schemas.lock.json`, or in `scripts/corpus.lock.json` for a repository, with its hash.
