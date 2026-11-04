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
key and shares the load of each. `createJwksCache` keeps the JWK Sets of other parties on it, by the `Clock` of the host, for
`jwtVerify` of jose: a set of up to 100 keys is fetched again past its lifetime, and for a missing `kid` at most once a refresh
time. `readTotalCount`, `hasNextLink` and
`readRetryAfterSeconds` read the paging and retry headers of an answer, and `findLinkTarget` gives the address of a link only on the
origin of the request. `@interopkit/core/http` holds the request
and the answer of a handler as plain data with bodies as bytes, `readText`, `readJson`, `readQuery` and `readForm` with a limit on its bytes,
`readBearerToken`, which reads the bearer token of RFC 6750 from `Authorization`, `buildJsonResponse`, and `negotiate`, which chooses a media type from `Accept`. For the providers of the 1EdTech services it reads
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
`@interopkit/core/checks` refuses, with `checkRemoteUrl` and `remoteUrlSchema`, a URL from a message or a document that names
its host by an IP address, a single label or a name of a private network, or that carries user information. It also reads the
formats that the standards share (a date, a date and time of RFC 3339, a UUID, a URI, a
language tag of RFC 5646, of at most 1,024 characters), copies JSON within a depth limit, tells whether the text of JSON nests deeper or has more tokens than a limit, or which of the two limits it passes first in one reading (`findExceededJsonLimit`), parses a text within both limits with the
sentences of its caller (`parseJsonText`), turns
the issues of a parse into findings or errors with a path, a rule and a sentence (`buildFindings`, `buildIssues`), and writes the sentence of the refusal of a reader. It
bounds the findings of a reader: `safeParseBounded` stops a parse at the first issue beyond a limit, and the `IssueSink` of
`createIssueSink` holds at most `DEFAULT_MAX_FINDINGS`, 1,000, and ends a list that stopped with an error that says so. `readJson` of
`@interopkit/core/http` also refuses a body above `maxTokens`.

`basePathSchema` of `@interopkit/core/http` reads the path that a handler is mounted at: `""` or a path that starts with `/` and
does not end with one, written as `URL` writes the path of a request, so that `/café` and `/caf%C3%A9` are one path and a path
whose dot segments leave `/` is refused. The provider of `competency-frameworks`, the LRS of `learning-records` and the provider
of `achievement-credentials` read their `basePath` with it.

`readAnswerJson` reads the JSON of the answer of a service within `maxDepth` (64) and `maxTokens` (1,000,000), counted in one
reading before it is parsed; `readAnswer` runs a reader on the data of an answer and names the service and the standard when the
data is not valid; `readStatusDetail` reads the status in the body of a refusal with the reader of a package, and its
`Retry-After`, and `readStatusInfo` reads it as the `imsx_StatusInfo` of the REST bindings of CASE, Open Badges and CLR; `hasNextPage` tells from `X-Total-Count`, `Link` and the size of a page whether a list paged by `limit` and
`offset` goes on. The clients of `competency-frameworks` and `achievement-credentials` read their answers with them.

`jsonValueSchema` and `jsonObjectSchema` of `@interopkit/core/checks` read any value of JSON, and an object of JSON, into a copy
that shares nothing with the input, and refuse what JSON cannot hold with a finding that says where. Every schema of an object
of `@interopkit/core/checks` and `copyJson` refuse a property named `__proto__`, `constructor` or `prototype` at any depth, with an
`invalid-value` at it, so that every reader of the family refuses it rather than drop it unseen or let it set a prototype.
