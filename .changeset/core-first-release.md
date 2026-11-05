---
"@interopkit/core": major
---

The foundation of `@interopkit/tool-integration`, `@interopkit/learning-analytics`, `@interopkit/competency-frameworks`,
`@interopkit/learning-records`, `@interopkit/selective-disclosure` and `@interopkit/achievement-credentials`: `InteropkitError`, `DataError` and
`ServiceError`, the checks of arguments, a `Clock`, `requestService` and `callService`, the calls to a service over HTTP with
a deadline, a size limit of 65,536 bytes unless the call says otherwise, no redirects, any of GET, POST, PUT, DELETE and HEAD,
bodies as text or bytes, statuses that a call returns as values, a `ServiceError` that carries the status, the headers and the
body of the answer, and a `signal` that ends the caller's wait, and
`raceAbort`, which ends one caller's wait on work that several callers share, and `createKeyedCache`, which keeps values by
key and shares the load of each. `readRetryAfterSeconds` reads the retry header of an answer, and `findLinkTarget` gives the address of a link only on the
origin of the request. `@interopkit/core/http` holds the request
and the answer of a handler as plain data with bodies as bytes, `readText`, `readJson`, `readQuery` and `readForm` with a limit on its bytes,
`readBearerToken`, which reads the bearer token of RFC 6750 from `Authorization`, and `buildJsonResponse`. For the providers of the 1EdTech services it reads
the `limit` and `offset` of a query (`readOffsetPage`), builds the `Link` header of a page with or without a known total
(`buildPageLinks`) and the `imsx_StatusInfo` answer of a failure (`buildStatusInfoResponse`), and reads the decision of a host's
`authorize` port, allowed with what it grants or refused with 401, 403 or 429, a reason, a challenge and `Retry-After` (`AccessDecision`,
`readAccessDecision`). A `Signer` signs with a key that the host holds,
in the process or in a KMS or an HSM, `createCryptoKeySigner` makes one from a `CryptoKey`, and `signCompactJws` assembles a
compact JWS and refuses a signature of the wrong form. `Random` and `SYSTEM_RANDOM` are the source of random picks.
`@interopkit/core/oauth` has the OAuth 2.0 clients on `oauth4webapi`: client credentials, authorization code with PKCE,
refresh, revocation and registration for the grants that the host names (the authorization code and refresh token grants
unless it says otherwise), authentication by secret, by a JWT that a `Signer` signs with claims of the client beside the registered ones, or by none, and a token cache
that shares one token among callers.
`@interopkit/core/checks` refuses, with `checkRemoteUrl`, a URL from a message or a document that names
its host by an IP address, a single label or a name of a private network, or that carries user information. It also reads the
formats that the standards share (a date, a date and time of RFC 3339 with `findInstant` and one of ISO 8601, extended or basic, with `findIsoInstant`, a UUID, a URI, a
language tag of RFC 5646, of at most 1,024 characters), copies JSON within a depth limit, tells whether two JSON values are the same whatever the order of the members of an object (`isSameJson`), tells whether the text of JSON nests deeper or has more tokens than a limit, or which of the two limits it passes first in one reading (`findExceededJsonLimit`), parses a text within both limits with the
sentences of its caller (`parseJsonText`), turns
the issues of a parse into errors with a path, a rule and a sentence (`buildIssues`), and writes the sentence of the refusal of a reader. It
bounds the findings of a reader: `safeParseBounded` stops a parse at the first issue beyond a limit, and the `IssueSink` of
`createIssueSink` holds at most `DEFAULT_MAX_FINDINGS`, 1,000, and ends a list that stopped with an error that says so. `readJson` of
`@interopkit/core/http` also refuses a body above `maxTokens`.

`basePathSchema` of `@interopkit/core/http` reads the path that a handler is mounted at: `""` or a path that starts with `/` and
does not end with one, written as `URL` writes the path of a request, so that `/café` and `/caf%C3%A9` are one path and a path
whose dot segments leave `/` is refused. The provider of `competency-frameworks`, the LRS of `learning-records` and the provider
of `achievement-credentials` read their `basePath` with it.

`readAnswerJson` reads the JSON of the answer of a service within `maxDepth` (64) and `maxTokens` (1,000,000), counted in one
reading before it is parsed; `readAnswer` runs a reader on the data of an answer and names the service and the standard when the
data is not valid; `readStatusInfo` reads the `imsx_StatusInfo` of the REST bindings of CASE, Open Badges and CLR in the body
of a refusal, and its `Retry-After`; `hasNextPage` tells from `X-Total-Count`, `Link` and the size of a page whether a list paged by `limit` and
`offset` goes on. The clients of `competency-frameworks` and `achievement-credentials` read their answers with them.

`jsonObjectSchema` of `@interopkit/core/checks` reads an object of JSON into a copy that shares nothing with the input, and
`opaqueJsonObjectSchema` and `opaqueJsonValueSchema` read an object, and any value, of opaque JSON, whose member names are data at
every depth, into such a copy, in which a member named `__proto__`, `constructor` or `prototype` is an own member; all three refuse what JSON
cannot hold with a finding that says where. Every other schema of an object
of `@interopkit/core/checks` and `copyJson` refuse a property named `__proto__`, `constructor` or `prototype` at any depth, with an
`invalid-value` at it, so that every reader of the family refuses it rather than drop it unseen or let it set a prototype;
`findPrototypeName` finds such a property for a walk of its own.
`mapSchema` refuses an object that is not plain, such as a `Map`, whose entries would read as an empty record.

Every function is named by what it does, with one verb for one meaning: a function that reads or writes a form that a standard defines is `read` or `write`, one that assembles plain data `build`, one that returns an object with behavior `create`, one that answers an HTTP request `handle`, a lookup `find` or `list`, and a predicate `is`. Optional parameters come in one options object: `buildJsonResponse(status, body, { headers, type })`, `callPort(call, { signal })` and `raceAbort(promise, { signal })`, as every other call that waits takes its `signal`; `JsonResponseOptions` is exported with `@interopkit/core/http`. `parseDateTime` throws a `DataError` for text that is not a date and time of RFC 3339, as every `parse` function does, and `isDateTime` tells beforehand. `Random` is an object with `uniform()`, as the random sources of `@assesskit/runtime` and `@measurekit/core` are, and `SYSTEM_RANDOM` is one, so that a host passes one source to every library. `checkArray` refuses an array with a hole, which `forEach`, `map` and `every` skip unseen. An option `clock` that is left out is `SYSTEM_CLOCK`, in `createKeyedCache`, `createTokenCache` and the calls of `@interopkit/core/oauth`; `checkClock` accepts none and `readClock` reads the clock of the system when it gets none.

`requestWithCredential` makes a request with the `Authorization` header that the host's `authorization` gives for it, under the signals of the call, and refuses a value that could end the header; `CredentialServiceCall` is its service, and `clientOptionsEntries` holds the schemas of the options that every client of a service takes. `readCallOptions` of `@interopkit/core/checks` reads the `signal` of the options of a call and refuses a property that is neither the `signal` nor one that the call names, so that a misspelled option is not dropped; `checkBaseUrl` refuses an address of a service with credentials, a query or a fragment; `formatDateTime` writes whole epoch milliseconds as RFC 3339 in UTC with milliseconds; and `Issue` is a finding with its `severity`, which every validator of the family lists. `readAnswer` keeps what the reader threw as the `cause` of its `DataError`, and the signer, `signCompactJws` and the keyed cache refuse options of a call that are not an object.

`LimitError`, a `DataError` with `limit`, the name of the limit, and `maximum`, its value, is what every reader of the family throws for input over a limit, so that a host answers 413 from one check: `readJson` and `readForm` of `@interopkit/core/http` at `maxBytes`, `maxDepth` and `maxTokens`, `readAnswerJson` at `maxDepth` and `maxTokens`, and the key set cache at 100 keys; `readAnswer` keeps a `LimitError` of its reader as one. Every error class takes `ErrorOptions`, `ServiceErrorOptions` extends it, and an error that reports another carries it as its `cause`: the failure of a `fetch` and its deadline, the refusals of oauth4webapi, and the errors of a decoder and of `JSON.parse`.

`AccessRefusal` is `{ reason, message }`, as every refusal of the family is. Its `reason` is a term of the exported kebab-case union `AccessRefusalReason`: `unauthenticated`, `forbidden` or `too-many-requests`, which sets the status of the answer, 401, 403 or 429, as `ACCESS_REFUSAL_STATUSES` writes it, and `message` is the sentence of the answer.

The `imsx_StatusInfo` of the services of 1EdTech is defined once. `StatusInfo`, `StatusCodeMinor` and `StatusCodeMinorField` take the codes of a service as a type parameter, `StatusInfo<TMinor extends string = string>`, and `STATUS_CODES_MAJOR` and `STATUS_SEVERITIES` are exported by the root. `buildRefusalResponse(refusal, codes, options)` of `@interopkit/core/http` answers the refusal of a host's `authorize` with 401, 403 or 429, the code that a service gives each reason, `WWW-Authenticate` and `Retry-After`, with `RefusalCodes` and `RefusalResponseOptions`.
