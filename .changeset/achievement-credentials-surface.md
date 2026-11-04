---
"@interopkit/achievement-credentials": major
---

The root exports no type of another entry: `BakedCredential` and `FoundKind` come from `/baking`, `CredentialsClient`,
`CredentialsClientOptions`, `DiscoverOptions` and `ServiceDescription` from `/client`, and `CredentialStore`, `ProfileStore`,
`CredentialsProviderOptions`, `CredentialsAccess`, `CredentialsPage`, `CredentialList`, `ReceivedCredential` and
`UpsertOutcome` from `/provider`. `BakedKind` is no longer exported: the readers give a `FoundKind`.
