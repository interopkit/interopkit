---
"@interopkit/competency-frameworks": major
---

The model of CASE 1.1 and 1.0: a competency framework package, each entity and set that the service exchanges, and
`imsx_StatusInfo`. `readPackage` and `readEntity` read a value of either version into the model of 1.1, check it against the
JSON schemas of 1EdTech and the rules of a package, and return a copy; they throw a `DataError` that names the path of the first
error and counts the others. `validatePackage` and `validateEntity` return the findings, at most `maxFindings` (1,000) of them, with their path, rule,
sentence and severity, as data: they find a property that CASE does not have, an identifier that two entities share, a link that points to
nothing, an `isChildOf` tree that loops (`child-of-cycle`), and an item that no chain of `isChildOf` leads to from the document
(`item-outside-tree`). They read the `CFPackageURI` and `CFDocumentURI` that some providers write in the form of a package,
which has none, leave them out and warn (`package-form-link`). `convertCaseVersion` takes a package or an entity of 1.1 to the form of 1.0, leaves out and reports what 1.0
cannot hold, and reports an identifier or a URI that 1.0 would refuse (`form-not-in-1.0`); like the readers, it refuses a member named `__proto__`,
`constructor` or `prototype`.
`@interopkit/competency-frameworks/graph` answers what a consumer asks of a framework: `buildFrameworkTree`, `listAssociations`,
`crosswalk`, `diffPackages`, `isNewer`, `readAdoptionStatus` and `buildEntityUri`.
`@interopkit/competency-frameworks/client` reads frameworks from a provider over the REST binding with the `fetch` of the host:
a call for each of the twelve endpoints with its set type, the document list as an async iterable that follows the paging
headers, the filter, sort and field selection of a request, and the discovery file; `readStatusInfo` of `@interopkit/core` reads the
`imsx_StatusInfo` and the `Retry-After` of a refusal.
`@interopkit/competency-frameworks/provider` serves a store of frameworks over the CASE REST binding: `handleCaseRequest`
answers the twelve endpoints in 1.1 and in 1.0 with paging, sorting, filtering, field selection (a `filter` and a `fields` list
of at most 2,048 characters each) and the `imsx_StatusInfo` of a
failure, refuses what `authorize` refuses with 401, 403 or 429 (an `AccessDecision` of `@interopkit/core/http`), passes the store the
page as an `OffsetPage` of `@interopkit/core/http`, and serves the discovery file that `localizeOpenApi` makes. It reads the query grammar and hands the store a `ParsedCaseQuery`, answering a filter or a selection it cannot use with 400, and
`queryEntities` filters and sorts documents in memory by the `collation` of the query, which the provider sets from its option.

The client refuses an answer that nests more than 128 levels of JSON before it parses it (an extension, which the readers bound to
64 levels, may sit below the levels of a package), and says that an answer whose bytes are not UTF-8 is not UTF-8 text.

Every function is named by what it does, with one verb for one meaning: a function that reads or writes a form that a standard defines is `read` or `write`, one that assembles plain data `build`, one that returns an object with behavior `create`, one that answers an HTTP request `handle`, a lookup `find` or `list`, and a predicate `is`. The options of the client factory are `CaseClientOptions`, as those of every other client factory are named, and `documents` writes the `filter` of its query.

A finding is an `Issue` of `@interopkit/core/checks`. The client makes its requests through `requestWithCredential` of core, and refuses a `baseUrl` with a query or a fragment, an empty one included. An answer of the client over `maxTokens` or 128 levels, and a value that `convertCaseVersion` reads over 64 levels, throw `LimitError` of core. `authorize` refuses a request with `{ allowed: false, reason, message? }`, whose `reason` is `unauthenticated`, `forbidden` or `too-many-requests`; the 401, 403 and 429 answers come from `buildRefusalResponse` of core, and the default message of a 429 is core's.

`ImsxStatusInfo` is the `StatusInfo` of `@interopkit/core` with the codes of the binding, `StatusInfo<StatusCodeMinorValue>`. `StatusCodeMinor`, `StatusCodeMinorField`, `STATUS_CODES_MAJOR` and `STATUS_SEVERITIES` are core's, and `STATUS_CODES_MINOR` and `StatusCodeMinorValue` are this package's.
