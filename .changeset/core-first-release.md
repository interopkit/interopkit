---
"@interopkit/core": minor
---

The foundation of `@interopkit/tool-integration`, `@interopkit/learning-analytics`, `@interopkit/competency-frameworks`,
`@interopkit/learning-records`, `@interopkit/selective-disclosure` and `@interopkit/achievement-credentials`: `InteropkitError`, `DataError` and
`ServiceError`, the checks of arguments, a `Clock`, `requestService` and `callService`, the calls to a service over HTTP with
a deadline, a size limit of 65,536 bytes unless the call says otherwise, no redirects, any of GET, POST, PUT, DELETE and HEAD,
bodies as text or bytes, statuses that a call returns as values, a `ServiceError` that carries the status, the headers and the
body of the answer, and a `signal` that ends the caller's wait, and
`untilAborted`, which ends one caller's wait on work that several callers share, and `createKeyedCache`, which keeps values by
key and shares the load of each. `createJwksCache` keeps the JWK Sets of other parties on it, by the `Clock` of the host, for
`jwtVerify` of jose: a set of up to 100 keys is fetched again past its lifetime, and for a missing `kid` at most once a refresh
time. `totalCountOf`, `hasNextLink` and
`retryAfterSeconds` read the paging and retry headers of an answer, and `linkTarget` gives the address of a link only on the
origin of the request. `@interopkit/core/http` holds the request
and the answer of a handler as plain data with bodies as bytes, `readText`, `readJson`, `readQuery` and `readForm` with a limit on its bytes,
`jsonResponse`, and `negotiate`, which chooses a media type from `Accept`. For the providers of the 1EdTech services it reads
the `limit` and `offset` of a query (`readOffsetPage`), builds the `Link` header of a page with or without a known total
(`offsetPageLinks`) and the `imsx_StatusInfo` answer of a failure (`statusInfoResponse`), and reads the decision of a host's
`authorize` port, allowed with what it grants or refused with 401, 403 or 429, a reason, a challenge and `Retry-After` (`AccessDecision`,
`readAccessDecision`). A `Signer` signs with a key that the host holds,
in the process or in a KMS or an HSM, `signerFromCryptoKey` makes one from a `CryptoKey`, and `signCompactJws` assembles a
compact JWS and refuses a signature of the wrong form. `Random` and `SYSTEM_RANDOM` are the source of random picks.
`@interopkit/core/oauth` has the OAuth 2.0 clients on `oauth4webapi`: client credentials, authorization code with PKCE,
refresh, revocation and registration for the grants that the host names (the authorization code and refresh token grants
unless it says otherwise), authentication by secret, by a JWT that a `Signer` signs with claims of the client beside the registered ones, or by none, and a token cache
that shares one token among callers.
`@interopkit/core/checks` refuses, with `checkRemoteUrl` and `remoteUrlSchema`, a URL from a message or a document that names
its host by an IP address, a single label or a name of a private network, or that carries user information. It also reads the
formats that the standards share (a date, a date and time of RFC 3339, a UUID, a URI, a
language tag of RFC 5646, of at most 1,024 characters), copies JSON within a depth limit, tells whether the text of JSON nests deeper or has more tokens than a limit, or which of the two limits it passes first in one reading (`exceededJsonLimit`), turns
the issues of a parse into findings with a path, a rule and a sentence, and writes the sentence of the refusal of a reader. It
bounds the findings of a reader: `safeParseBounded` stops a parse at the first issue beyond a limit, and `createFindingSink`
holds at most `DEFAULT_MAX_FINDINGS`, 1,000, and ends a list that stopped with a finding that says so. `readJson` of
`@interopkit/core/http` also refuses a body above `maxTokens`.
