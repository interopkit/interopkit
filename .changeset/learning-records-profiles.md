---
"@interopkit/learning-records": major
---

xAPI Profiles 1.0 in `@interopkit/learning-records/profiles`. `readProfile` reads a profile, or the text of its JSON within
`maxTokens`, into the model of every concept, Statement Template, rule and Pattern, and `validateProfile` lists what breaks the
rules of Part Two: the shape, empty values and properties that are no IRI, the context, the ids and `inScheme`, the revisions of
the versions, the relations of concepts to this profile and to others given in `profiles`, the JSON Schema of an extension, the
Activity Definition of an Activity concept by the rules of xAPI, the Determining Properties and StatementRef templates, the
JSONPath of each rule, and the kind, members, description and cycles of each Pattern.

`createProfileValidator` readies a profile's Statement Templates, with those of other profiles that its Patterns reuse, and the
Patterns that its primary Patterns reach. `validateStatement` gives the outcome of the Statement Template algorithm of Part Three
(`success`, `invalid`, `unmatched`) with the templates and the rules broken, StatementRefs found through `findStatement`, and
extensions out of their place. `validateStatements` judges the Statements of a list that name the profile, groups them by
registration and subregistration, orders them by timestamp, and matches each series greedily against the primary Patterns, with
each Pattern's outcome (`success`, `partial`, `failure`) and the Statements it left. The matching keeps what each Pattern gives at
each position, so its time grows with the Statements and the members alone; the limits are `maxStatements` (10,000),
`MAX_MATCHED_PATTERNS` (1,000) and `MAX_MATCHED_MEMBERS` (10,000).
