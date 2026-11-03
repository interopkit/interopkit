---
"@interopkit/competency-frameworks": major
---

Every function is named by what it does, with one verb for one meaning: `readAdoptionStatus` (was `adoptionStatus`), `listAssociations` (was `associationsOf`), `buildEntityUri` (was `caseEntityUri`), `writeCaseFilter` (was `caseFilter`), `buildFrameworkTree` (was `frameworkTree`) and `convertCaseVersion` (was `toCaseVersion`). A function that reads or writes a form that a standard defines is named `read` or `write`, one that assembles plain data `build`, one that returns an object with behavior `create`, one that answers an HTTP request `handle`, a lookup `find` or `list`, a predicate `is`, and no old name is kept as an alias.

`CaseClientConfig` is `CaseClientOptions`, as the options of every other client factory are named.

`QueryRefusal` of `parseCaseQuery` is `{ reason, message }` where it was `{ refused, detail }`, and `QueryRefusalReason` names the two codes of the REST binding.
