---
"@interopkit/competency-frameworks": minor
---

The model of CASE 1.1 and 1.0: a competency framework package, each entity and set that the service exchanges, and
`imsx_StatusInfo`. `readPackage` and `readEntity` read a value of either version into the model of 1.1, check it against the
JSON schemas of 1EdTech and the rules of a package, and return a copy; they throw a `DataError` that names the path of the first
error and counts the others. `validatePackage` and `validateEntity` return the findings, at most `maxFindings` (1,000) of them, with their path, rule,
sentence and severity, as data: they find a property that CASE does not have, an identifier that two entities share, a link that points to
nothing, an `isChildOf` tree that loops (`child-of-cycle`), and an item that no chain of `isChildOf` leads to from the document
(`item-outside-tree`). They read the `CFPackageURI` and `CFDocumentURI` that some providers write in the form of a package,
which has none, leave them out and warn (`package-form-link`). `toCaseVersion` takes a package or an entity of 1.1 to the form of 1.0, leaves out and reports what 1.0
cannot hold, and reports an identifier or a URI that 1.0 would refuse (`form-not-in-1.0`).
`@interopkit/competency-frameworks/graph` answers what a consumer asks of a framework: `frameworkTree`, `associationsOf`,
`crosswalk`, `diffPackages`, `isNewer`, `adoptionStatus` and `caseEntityUri`.
`@interopkit/competency-frameworks/client` reads frameworks from a provider over the REST binding with the `fetch` of the host:
a call for each of the twelve endpoints with its set type, the document list as an async iterable that follows the paging
headers, the filter, sort and field selection of a request, the discovery file, and `readStatusInfo`, which reads the
`imsx_StatusInfo` and the `Retry-After` of a refusal.
`@interopkit/competency-frameworks/provider` serves a store of frameworks over the CASE REST binding: `handleCaseRequest`
answers the twelve endpoints in 1.1 and in 1.0 with paging, sorting, filtering, field selection (a `filter` and a `fields` list
of at most 2,048 characters each) and the `imsx_StatusInfo` of a
failure, refuses what `authorize` refuses with 401, 403 or 429 (an `AccessDecision` of `@interopkit/core/http`), passes the store the
page as an `OffsetPage` of `@interopkit/core/http`, and serves the discovery file that `localizeOpenApi` makes. `parseCaseQuery` reads the query grammar, and
`queryEntities` filters and sorts documents in memory.
