---
"@interopkit/core": minor
---

The foundation of `@interopkit/tool-integration`, `@interopkit/learning-analytics`, `@interopkit/competency-frameworks`,
`@interopkit/learning-records`, `@interopkit/selective-disclosure` and `@interopkit/achievement-credentials`: `InteropkitError`, `DataError` and
`ServiceError`, the checks of arguments, a `Clock`, `requestService` and `callService`, the calls to a service over HTTP with
a deadline, a size limit of 65,536 bytes unless the call says otherwise, no redirects, any of GET, POST, PUT, DELETE and HEAD,
bodies as text or bytes, statuses that a call returns as values, a `ServiceError` that carries the status, the headers and the
body of the answer, and a `signal` that ends the caller's wait, and
`untilAborted`, which ends one caller's wait on work that several callers share. `totalCountOf`, `hasNextLink` and
`retryAfterSeconds` read the paging and retry headers of an answer. `@interopkit/core/http` holds the request
and the answer of a handler as plain data with bodies as bytes, `readText`, `readJson`, `readQuery` and `readForm`,
`jsonResponse`, and `negotiate`, which chooses a media type from `Accept`. A `Signer` signs with a key that the host holds,
in the process or in a KMS or an HSM, `signerFromCryptoKey` makes one from a `CryptoKey`, and `signCompactJws` assembles a
compact JWS and refuses a signature of the wrong form. `Random` and `SYSTEM_RANDOM` are the source of random picks.
`@interopkit/core/oauth` has the OAuth 2.0 clients on `oauth4webapi`: client credentials, authorization code with PKCE,
refresh, revocation and registration for the grants that the host names (the authorization code and refresh token grants
unless it says otherwise), authentication by secret, by a JWT that a `Signer` signs, or by none, and a token cache
that shares one token among callers.
`@interopkit/core/checks` also reads the formats that the standards share (a date, a date and time of RFC 3339, a UUID, a URI, a
language tag of RFC 5646), copies JSON within a depth limit, tells whether the text of JSON nests deeper or has more tokens than a limit, turns
the issues of a parse into findings with a path, a rule and a sentence, and writes the sentence of the refusal of a reader. It
bounds the findings of a reader: `safeParseBounded` stops a parse at the first issue beyond a limit, and `createFindingSink`
holds at most `DEFAULT_MAX_FINDINGS`, 1,000, and ends a list that stopped with a finding that says so. `readJson` of
`@interopkit/core/http` also refuses a body above `maxTokens`.
