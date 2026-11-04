# Evidence for tool-integration

What shows that the package does what it says: the vocabularies and examples of the specifications, tokens that another library
signs, a round trip between the two roles, tools of other authors that launch from the platform role and use its services, Moodle
in both roles, and four runtimes. Each layer answers a question that the one before cannot. The speed, the size and the peak
memory are in [performance](performance.md).

```mermaid
flowchart LR
  spec["Tables and examples<br/>of the specifications<br/>pnpm test:spec"] --> trip["Round trips between<br/>the two roles<br/>pnpm test"]
  tokens["Tokens that PyJWT signs<br/>pnpm test"] --> trip
  trip --> process["Tools of other authors<br/>in the process of the tests<br/>pnpm test:references"]
  process --> py["PyLTI1p3 in a container<br/>pnpm pylti1p3"]
  py --> moodle["Moodle in containers,<br/>both roles<br/>pnpm moodle"]
  moodle --> hand["saLTIre and the reference tool<br/>by hand before a release"]
  trip --> rules["Mutation rules<br/>pnpm check:rules"]
  trip --> runtimes["Node.js, Deno, Bun, workerd<br/>pnpm compat:runtimes"]
```

| Layer              | Question                                                                                              | Where                                                                                           | Runs                    |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| Specifications     | Does each vocabulary, variable, message and body that the specifications print read and write back?   | `scripts/lti-tables.ts`, `packages/tool-integration/test/*.spec.test.ts`                        | `pnpm test:spec`        |
| Tokens             | Does the tool verify, or refuse with its reason, what another library signs in each algorithm?        | `validation/lti_tokens.py`, `packages/tool-integration/test/tool-tokens.test.ts`                | `pnpm test`             |
| Round trips        | Does each role take what the other gives, for every message and every service?                        | `examples/tool-integration`, `packages/tool-integration/test/*.test.ts`                         | `pnpm test`             |
| In-process tools   | Do tools of other authors launch from the platform role and use its services and its registration?    | `packages/tool-integration/test/references*.test.ts`                                            | `pnpm test:references`  |
| PyLTI1p3           | Does a tool with its own HTTP stack, checks and cache launch from the platform over `https`?          | `validation/pylti1p3/`, `packages/tool-integration/test/pylti1p3.corpus.test.ts`                | `pnpm pylti1p3`         |
| Moodle             | Does Moodle launch a tool built on the package, and does it use a platform built on the package, with registration, launch, services and Deep Linking? | `validation/moodle/`, `packages/tool-integration/test/moodle.corpus.test.ts` | `pnpm moodle` |
| Online testers     | Do the testers that 1EdTech and saLTIre host pass the platform and the tool?                           | The log below                                                                                   | By hand before a release |
| Mutation rules     | Does the test of each rule that keeps a request from being forged, replayed or redirected fail without it? | `scripts/rules/tool-integration.ts`                                                        | `pnpm check:rules`      |
| Runtimes           | Does the example give the same results on each runtime?                                               | `compat/`                                                                                       | `pnpm compat:runtimes`           |

## Tools in the process of the tests

Each library plays the tool, and the platform role is the platform of the references: it signs with RS256 or ES256, keeps the
messages in a store, issues tokens, and serves a gradebook, a roster and groups over stores in memory. The libraries call the
global `fetch`, so the test replaces it with a network that reaches the handler of each origin, and plays the browser between the
two. `pnpm test:references` runs the three files; `pnpm test` leaves them out.

| Library             | Version | Flows that pass                                                                                                                                                                                                                                                                                           |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lti-tool/core`    | 1.2.2   | The launch of a platform that signs with RS256 and with ES256; the line item read, created, updated and deleted, the container with its filters, a score, the results, and the later of two scores kept; the members; a Deep Linking answer that the platform reads with its own data; Dynamic Registration from the initiation URL to the launch of the registered tool, with the single use of the registration token |
| `lti-core`          | 0.4.0   | The launch of a resource link, the single use of its `state`, and a Deep Linking answer that the platform reads with its own data                                                                                                                                                                          |

The versions are the newest that `minimumReleaseAge` of `pnpm-workspace.yaml` (14 days) installs on 2026-11-02. `@lti-tool/core`
1.3.0 was published without its build, and 1.3.1 to 1.3.3 are younger than 14 days. The fake platform of `lti-core/testing`
exists from 0.5.0, published 2026-10-29, so the tool role does not yet run against it.

## PyLTI1p3

[`validation/pylti1p3/`](../../validation/pylti1p3/README.md) starts a tool built on PyLTI1p3 2.0.0 in a container. The platform
serves `https` from the process of the tests with a certificate of its own authority, which the container trusts, so every call
of the tool to the key set, the token endpoint and the services is a real request. These flows pass, for each message and
signature:

| Flow                                                                                                                              | What it shows                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The launch of a resource link, the platform signing with RS256 and with ES256                                                     | Checks the state, the nonce, the deployment, the signature and the message; reads the claims |
| A second authentication request of one login, and an `id_token` carried to a state that the tool did not issue                     | The platform refuses the first; PyLTI1p3 refuses the second                              |
| The line item of the launch, the container, a line item created and found again by its tag, a score, the results                    | `get_lineitem`, `get_lineitems`, `find_or_create_lineitem`, `put_grade`, `get_grades`    |
| The members and the context of the roster                                                                                         | `get_members`, `get_context`                                                            |
| The groups and the group sets of the context                                                                                      | `get_groups`, `get_sets`                                                                |
| A Submission Review request for a learner, and the line item that it names                                                        | `is_submission_review_launch`, `get_submission_review_user`                             |
| A Deep Linking request, answered with an item that the platform reads with its own data                                           | `DeepLink.get_response_jwt`                                                             |
| A login whose `target_link_uri` is another URL of the tool than its launch URL                                                    | Takes the target from the claim of the launch and sends its launch URL as the redirect URI |

## Differences from the references

The references are stricter than the specifications in these places. The platform does what the specification says, and a test
pins what the reference does with it.

| Reference        | What it does                                                                                                         | What the specification says                                                                                          | What a host does                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `@lti-tool/core` | Refuses a launch whose user has no `given_name`, no `family_name` or no `email`, each in a test of its own            | LTI Core 5.3.6: `sub` is the only required claim of the user, and 5.3.6.1 lets a platform omit the others                 | Gives the names and the email in `user` for a tool that needs them                                                       |
| `@lti-tool/core` | Refuses a page of members in which a member has no `status` or no `name`                                             | NRPS 2.3: a membership without a status is `Active`; NRPS 2: a tool should never rely on additional member attributes | The platform writes what the store gives and applies no default, so the store gives `status` and `name` for such a tool   |
| `lti-core`       | Verifies RS256 alone                                                                                                 | Security Framework 7.2: an implementation should support all six approved algorithms, and uses one of them               | A platform that launches this tool signs with RS256                                                                      |

Proctoring Services and the AfA PNP Connector have no counterparty: their examples and round trips are the evidence.

## Moodle

[`validation/moodle/`](../../validation/moodle/README.md) starts Moodle 5.3.0 and its database in containers, and runs both roles of
the package against it, with the tool and the platform of the package in the process of the tests, over `https`, with a certificate
authority of the run that Moodle trusts. The flows go through the pages and endpoints that a browser and a tool use; the
preparation that a person does in the interface (users, a course, an activity, a grade) and the reading of the gradebook go
through a script of Moodle.

| Moodle is | Flows that pass                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform  | Dynamic Registration from the administrator's page to the activation of the tool; the launch of an activity, the login and the launch compared on `target_link_uri`, also when it has a query of its own; the line item, the container, a created line item, a score that the gradebook shows, and the results read without a `limit`; the members of the course; a Deep Linking request answered with an item that Moodle verifies |
| Tool      | Dynamic Registration from "Register a platform" to the activation of the platform; the launch of a published course, which provisions and enrols the learner; the members that Moodle reads from the roster service; the grade that it posts to the line item                    |

The names of the machine are dotted (`moodle.test`, `tool.example.org`, `platform.example.org`), so that every address passes the
check of a public host; `serviceOrigins` is not needed.

### What Moodle does differently

| Moodle                                                                                                                  | The specification                                                                               | The package                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Answers a registration with `"logo_uri": ""`                                                                            | Dynamic Registration 2.2: the addresses are URLs when present                                    | **Fixed.** Both readers of a registration take an empty address as absent ([spec-gaps](spec-gaps.md))                                                  |
| Posts a score with `"timestamp": "2026-11-02T14:55:32+0000"`, the form of PHP's `DATE_ISO8601`                          | AGS 3.4.8: ISO 8601 with a time zone                                                             | **Fixed.** The readers take `+hhmm` as `+hh:mm` ([spec-gaps](spec-gaps.md))                                                                            |
| Answers a request for results that carries `limit` with 404 and an HTML page: its code for LTI 1.3 calls a method on `null` (`results.php`, line 238 of 5.3.0) | AGS 3.3: `limit` is optional                                                                    | **Fixed** in the client: a request for results carries a `limit` only when the caller names one, and the flow reads the results without it. A request with a `limit` still gets the 404, which the test pins |
| Names a context role in the roster by its simple name (`Instructor`), where its launch has the URI                      | NRPS 2 and LTI Core Appendix A: both forms exist                                                | Not changed. A member keeps the role as sent; `canonicalizeRole` gives the URI                                                                         |
| As a tool, ends a launch whose context has no `type` in an error page (`tool_launch_service.php`, line 132)             | LTI Core 5.4.1: `type` is optional                                                              | Not changed. The host of a platform that launches Moodle sends the type, and the test pins the error page                                              |

## Online testers, by hand

saLTIre and the reference tool of 1EdTech (`lti-ri.imsglobal.org`) run on the internet and call the platform and the tool back, so
a person runs them before a release with the example platform and the example tool on public addresses. The log has one row for
each run, with the date, the commit that was tested, the tester and the result.

| Date | Commit | Tester | Result |
| ---- | ------ | ------ | ------ |
|      |        |        | No run has been made yet |

What a run checks, beyond the flows that the counterparties above already pass:

| Role under test | Check | Why no automated run covers it |
| --- | --- | --- |
| Tool | A launch in a frame whose browser blocks third-party cookies, with `lti_storage_target`: the storage page, then the verification page's post accepted by its `Origin` | Moodle sends no `lti_storage_target`; the browser tests play the platform's storage in one origin |
| Tool | A launch with `lti_storage_target` in a new window or tab, which has an opener or none | The same |
| Tool | The token request, which carries `client_id` and `application/x-www-form-urlencoded;charset=UTF-8` as `oauth4webapi` writes it: legal under RFC 7521 section 4.2, absent from the example of Security Framework 4.1.1 | Only Moodle's token endpoint has taken it |
| Tool | A Deep Linking response and a Start Assessment message posted to a return URL that redirects: `form-action` allows the origin of the address alone | Moodle answers at the address |
| Tool | The line items, results with and without `limit`, scores, members and groups against a platform other than Moodle | The same |
| Platform | The launch, Deep Linking, the grade services and the roster as each tester's tool calls them | `@lti-tool/core`, `lti-core` and PyLTI1p3 are libraries, not the testers' tools |

## Runtimes

`pnpm compat:runtimes` bundles the scenario of the example with the packages as they ship and runs it on Node.js, Deno, Bun and workerd.
The scenario launches a resource link, a Deep Linking request, a Start Proctoring message, a Submission Review request and an End
Assessment message; grades, reads the roster and the groups, pauses a proctored attempt, and registers a second tool through
Dynamic Registration. Web Crypto signs and verifies ES256 and RS256 and seals with HMAC alike on the four runtimes, and the
results equal those of Node.js.
