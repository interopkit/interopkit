---
"@interopkit/learning-records": major
---

The model of xAPI 2.0: a Statement and everything it holds, and the vocabularies. `readStatement` reads a
value into the model for the rules of an LRS or of a Learning Record Provider (`role`), checks every property against the tables
of the standard and the rules between them, and returns a copy; it throws a `DataError` that names the path of the first error
and counts the others. `validateStatement` and `validateStatements` return the findings, at most `maxFindings` (1,000) of them for a whole batch,
with their path, rule, sentence and severity, as data: identifiers, the voided verb, scores, the forms of IRIs, UUIDs, times, durations and language tags, the form of
each interaction's response patterns, and for a provider UTC times and what the LRS sets. `parseStatementJson` parses the text of
a request within limits of size, depth and tokens, at two to three times the time of `JSON.parse`, and refuses an object that
names a property twice; a text over a limit of its size throws `LimitError` of `@interopkit/core`. `buildStatement` makes the
Statement of an event with the time in UTC, and checks it against the rules of a provider; `buildVoidingStatement` makes the one that
voids another; `deriveStatementId` gives an event an id that a resend repeats; `formatDuration`, `parseDuration`
and `mboxSha1sum` write and read the durations and hashes of the standard. `isSameStatement` compares two
Statements by the rules of immutability, `isSameActor` compares two Agents or Groups by their identifier, `findStatementTime` reads the time of a Statement of either version, and `formatStatement` returns a Statement as `ids`, `exact` or `canonical`.
`@interopkit/learning-records/attachments` writes and reads the `multipart/mixed` message of Statements and Attachment data, matched
by SHA-2 hash and read within limits of parts and bytes, and `@interopkit/learning-records/signing` signs a Statement over a
`Signer` of `@interopkit/core` with RS256, RS384 or RS512 and verifies the signature against the key of the caller or the leaf of
its `x5c`, with the equivalence of the payload and its id, time and Attachments.
`@interopkit/learning-records/client` is the client of an LRS over the `fetch` of the host: `createLrsClient` sends Statements with
`PUT` and `POST`, fetches one or queries them in pages that follow `more` on the origin of the LRS, reads and writes the State,
Agent Profile and Activity Profile documents under the preconditions that `version` requires, and asks for Activities, Agents and
About; `moreStatements` goes on from a page that a host kept, a read names its `languages`, and a forwarder sends what another LRS
holds with `role: "lrs"`. Statements are checked before they are sent and every answer is read into the model.
`@interopkit/learning-records/store` is the handler of an LRS over plain requests and the ports of the host's stores:
`handleLrsRequest` answers the seven resources, HEAD included: Statements, with the version header, errors by `Accept`,
`access`, whose `AccessDecision` of `@interopkit/core/http` grants an `LrsGrant` or refuses with 401, 403 or 429, the limits, voiding, the filters with the Statement References that `matchesStatementQuery` judges, pages with
`more`, the formats, Attachments and signatures, a batch stored whole or not at all, and `statements.read.mine`; State and both profiles, under ETags with `If-Match`, `If-None-Match`, JSON
merge and the retry of lost races; Agents, Activities and About. `readBasicAuthorization` reads HTTP Basic.
A profile such as cmi5 judges each batch with `accept`, which sees the Statements as the request sent them and the `principal` that
`access` names, and refuses with `acceptStatus`, 400 or 403.
An LRS that the handler answers for passes the 1,442 tests of the ADL conformance suite for xAPI 2.0, and the reader of an LRS
agrees with SQL LRS on 147 of the 153 rules of the standard; the client takes the answer of a resend that an LRS gives with
no ids.
xAPI 1.0.3 runs beside 2.0. The readers take `version`, with the rules of 1.0.3 for each role; `buildStatement`,
`buildVoidingStatement` and `signStatement` take it too; `convertStatementVersion` gives a Statement in the form of 1.0.3. The client
speaks the version it is given, and `handleLrsRequest` routes each request by its `X-Experience-API-Version` header among the
option `versions`, with the alternate request syntax, the preconditions of 1.0.3 through an unconditional write of
`DocumentStore`, and reads and resends across routes. It passes the 1,365 tests of the ADL suite for 1.0.3.
`buildStatement` requires the `timestamp` of the event as it requires the id. The handler verifies a signature once for each
Statement that names it, reads its payload within the limits of the request, and refuses with 413 a request whose signatures,
counted for each Statement, pass `maxBodyBytes`; the client checks that a fetched Statement or Activity has the id it asked for.

Every function is named by what it does, with one verb for one meaning: a function that reads or writes a form that a standard defines is `read` or `write`, one that assembles plain data `build`, one that returns an object with behavior `create`, one that answers an HTTP request `handle`, a lookup `find` or `list`, and a predicate `is`. `parseStatementJson`, with `ParseStatementJsonOptions`, gives JSON and no model, so it is a `parse` by the verb of the family. The options of `createLrsClient` are `LrsClientOptions`, as those of every other client factory are named. `parseDuration` throws a `DataError` for text that is not an ISO 8601 duration, as every `parse` function does, and `isDuration` tells beforehand. `ContextActivities` is an interface whose four properties are documented, and the guide of the model names `XAPI_VERSIONS` and `STATEMENT_FORMATS`. An option `clock` of `handleLrsRequest` that is left out is `SYSTEM_CLOCK`.

A finding is an `Issue` of `@interopkit/core/checks`, and a Timestamp is written by `formatDateTime` of `@interopkit/core/checks`; a time with an offset is `formatDateTime(parseDateTime(text))`. The client of an LRS makes its requests through `requestWithCredential` of core, reads the options of a call that carries only a `signal` with `readCallOptions` of core, which refuses any other property, and names what is wrong with an `endpoint` in the message: not https, credentials, a query or a fragment, or no final slash. An error that a reader of an answer throws becomes a `DataError` that names the LRS, with the error as its `cause`.

`LimitError` of `@interopkit/core` is what the readers throw for input over a limit, with `limit` named by the option, `maxBytes`, `maxDepth`, `maxTokens`, `maxParts`, `maxPartBytes`, `maxTotalBytes` or `maxHeaderBytes`, and `maximum`, its value. Depth is a limit as the others are, so the LRS answers 413 for JSON that nests deeper than `maxDepth`, and for a merge of a document as well. `access` refuses a request with `{ allowed: false, reason, message? }`, whose `reason` is `unauthenticated`, `forbidden` or `too-many-requests`.

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
