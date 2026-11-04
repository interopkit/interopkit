---
"@interopkit/core": major
---

`requestWithCredential` makes a request with the `Authorization` header that the host's `authorization` gives for it, under the signals of the call, and refuses a value that could end the header; `CredentialServiceCall` is its service, and `clientOptionsEntries` holds the schemas of the options that every client of a service takes. `@interopkit/core/checks` gains `readCallOptions`, which reads the `signal` of the options of a call, `checkBaseUrl`, which refuses an address of a service with credentials, a query or a fragment, `formatDateTime`, which writes whole epoch milliseconds as RFC 3339 in UTC with milliseconds, and `Issue`, a finding with its `severity`, which every validator of the family lists. `readAnswer` keeps what the reader threw as the `cause` of its `DataError`, and the signer, `signCompactJws` and the keyed cache refuse options of a call that are not an object.
