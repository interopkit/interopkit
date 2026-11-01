---
"@interopkit/competency-frameworks": minor
---

The model of CASE 1.1 and 1.0: a competency framework package, each entity and set that the service exchanges, and
`imsx_StatusInfo`. `readPackage` and `readEntity` check a value against the JSON schemas of 1EdTech and return a copy, with a
finding for each fault that names its path and rule; `checkPackage` lists the findings of a package, and the rules of a package
find identifiers that two entities share, links that point to nothing, and an `isChildOf` tree that loops. `toCaseVersion` takes
a package or an entity of 1.1 to the form of 1.0 and reports what 1.0 cannot hold.
