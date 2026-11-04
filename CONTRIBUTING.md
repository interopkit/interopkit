# Contributing

Contributions in English or Bahasa Indonesia are welcome. Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

```mermaid
flowchart LR
  subgraph repo["The repository"]
    packages["packages/core, tool-integration,<br/>learning-analytics, competency-frameworks,<br/>learning-records, selective-disclosure,<br/>achievement-credentials, course-launch<br/>src, test"]
    docs["docs/core, docs/tool-integration,<br/>docs/learning-analytics, docs/competency-frameworks,<br/>docs/learning-records, docs/selective-disclosure,<br/>docs/achievement-credentials, docs/course-launch<br/>guides that run in tests"]
    examples["examples<br/>run by a test"]
    tooling["scripts, validation, compat"]
  end
  change["Your change"] --> local["Local gates<br/>lint, check:standards, check:duplication, typecheck, test, knip"]
  local --> hooks["Pre-commit: Biome formats<br/>Pre-push: typecheck, test, knip"]
  hooks --> pr["Pull request<br/>with a changeset"]
  pr --> ci["CI: check, test on Node 22 and 24,<br/>spec, browsers, runtimes"]
  ci --> review["Review"]
  review --> merge["Merge"]
  repo -.- change
```

## Setup

Node.js 22.18+ and pnpm 12 are required. One command sets the repository up, and in a git clone it also installs the Lefthook git hooks (`scripts/prepare.ts`, which runs the same on Windows and on POSIX):

```bash
pnpm install
```

[AGENTS.md](AGENTS.md) lists the commands and the conventions for layout, naming, code, docs and tests.

## Issues

| Kind            | What to give                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Bug report      | The smallest code that runs as pasted, and the section of the specification that defines the behavior you expected |
| Feature request | Only for something that belongs to a section of a specification the packages implement; name that section          |
| Vulnerability   | A private report, as [SECURITY.md](SECURITY.md) describes                                                          |

## Evidence

A change to a rule of a specification cites its section in the pull request and adds or updates its test.

| Rule                        | What it means                                                                                                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test titles                 | A plain sentence about behavior, with no identifier of a row, a unit or a clause                                                                                                                                                                                                                   |
| Fixtures                    | They come from oracles, never typed by hand except for edge cases derivable exactly: tokens signed by another implementation, published examples, or output of a script in `validation/`. Specification files are never committed; `pnpm corpus` and `pnpm schemas` download them at pinned hashes |
| Security rules              | A rule that keeps a request from being forged, replayed or redirected has an entry in `scripts/rules/<package>.ts`: the text that implements it, what stands in its place without it, and the test that must fail. `pnpm check:rules` proves that it does                                              |
| A gap in the specifications | A place where they contradict themselves or are silent gets a resolution in the `spec-gaps.md` of the package and a test                                                                                                                                                                           |

## Before opening a pull request

| Run                                                                             | When                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`, `pnpm check:standards`, `pnpm check:duplication`, `pnpm typecheck`, `pnpm test`, `pnpm knip` | Always                                                                                                      |
| `pnpm build`, `pnpm check:packages`, `pnpm check:release`, `pnpm check:tarballs`, `pnpm docs:api` | Always                                                                                                                         |
| `pnpm check:rules`                                                              | A change to code that an entry of `scripts/rules/` names, or to a security rule                                               |
| `pnpm test:browser`                                                             | A change to the pages of the client-side login, or to code that must run in a browser; it needs `pnpm exec playwright install` |
| `pnpm compat`                                                                   | A change that could differ between runtimes: a use of Web Crypto, `fetch`, `URL` or `AbortSignal`                                   |
| `pnpm check:licenses`, `pnpm check:audit`                                       | A change to a dependency                                                                                                       |
| `pnpm corpus`, `pnpm schemas`, `pnpm spec-examples`, `pnpm test:spec`           | A change to what the downloaded files are read for                                                                             |
| `pnpm bench`                                                                    | A change to a hot path that a `*.bench.ts` times (a reader, a validator, a builder, a hash, a signature, a conversion, a client or a handler), to a credential's verification, to the launch, the authorization or the pages of the services of LTI, to the three roles of `selective-disclosure`, or to a budget; `pnpm schemas` and `pnpm corpus` first |
| `pnpm test:references`                                                          | A change to the platform role or the tool role of `tool-integration`                                                           |
| `pnpm opensalt`                                                                 | A change to the CASE client or provider, or to the example that they run in; it needs Docker                                   |
| `pnpm adl-lrs`                                                                  | A change to the LRS handler, or to the example that runs it                                                                       |
| `pnpm sql-lrs`                                                                  | A change to the readers of Statements, the LRS handler or the client; it needs Docker                                          |
| `pnpm pylti1p3`                                                                 | A change to the platform role of `tool-integration` or to the launch, token or service routes it serves; it needs Docker and `openssl` |
| `pnpm moodle`                                                                   | A change to the registration, the launch, the services or Deep Linking of either role of `tool-integration`; it needs Docker, `git` and `openssl` |
| `pnpm w3c-suites`                                                               | A change to the credentials, their proofs, their status lists or their verification, or to the VC-API service of the example; `pnpm schemas` first |
| `pnpm validator`                                                                | A change to the credentials, their baking or their JWTs, or to the example that makes them; it needs Docker and `pnpm schemas` first |

- A change to a package goes into the pending release's changeset in `.changeset/`, or a new one made with `pnpm changeset`
  when none is pending ([AGENTS.md](AGENTS.md#releases)).
- A change to behavior also changes the TSDoc of what it touches and the guide of the module in `docs/`. A change to what is
  supported also changes the `supported.md` of the package.
- The pre-commit hook formats staged code, JSON and YAML with Biome; the pre-push hook runs the type check, the tests and
  Knip.

## License of contributions

interopkit is licensed under the [Apache License 2.0](LICENSE). As its section 5 states, a contribution you submit for
inclusion is licensed under the same terms, unless you state otherwise. There is no contributor license agreement; you keep the
copyright in your contributions. Do not contribute files you do not have the right to license: the repository contains no
1EdTech specification file, schema or test suite.
