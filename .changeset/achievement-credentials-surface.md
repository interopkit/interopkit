---
"@interopkit/achievement-credentials": major
---

The root exports no type of another entry: `BakedCredential` and `FoundKind` come from `/baking`, `CredentialsClient`,
`CredentialsClientOptions`, `DiscoverOptions` and `ServiceDescription` from `/client`, and `CredentialStore`, `ProfileStore`,
`CredentialsProviderOptions`, `CredentialsAccess`, `CredentialsPage`, `CredentialList`, `ReceivedCredential` and
`UpsertOutcome` from `/provider`. `BakedKind` is no longer exported: the readers give a `FoundKind`.

`createContextLoader` no longer takes `cache`, and `ContextCache` is gone: a context comes from `documents` or from the `fetch`
the host passes, and a host that keeps fetched contexts between processes does so in that `fetch`; every source is checked
against its pin as before. The loader declares its options in a strict schema, so it refuses `cache` and every option it does
not take, whatever its type.
