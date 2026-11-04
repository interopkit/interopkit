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

`ImsxStatusInfo` is the `StatusInfo` of `@interopkit/core` with the codes of Open Badges, `StatusInfo<StatusCodeMinorValue>`.
`ImsxCodeMinor` and `ImsxCodeMinorField` are gone: they are `StatusCodeMinor` and `StatusCodeMinorField` of core, as are
`STATUS_CODES_MAJOR` and `STATUS_SEVERITIES`, which the package no longer exports, nor `StatusCodeMajor` and `StatusSeverity`
(`ImsxStatusInfo["imsx_codeMajor"]` and `ImsxStatusInfo["imsx_severity"]` are the same types). `STATUS_CODES_MINOR` and
`StatusCodeMinorValue` stay. The 401, 403 and 429 answers to a refusal of the host come from `buildRefusalResponse` of core,
with the same codes and headers; the default message of a 429 is core's.

Every public function declares its options in a strict schema and refuses any option it does not take, whatever its type; the
verification family had checked the type of an option that a function does not declare and let a right-typed one pass.
`readCredentialJwt` now refuses `fetch`, `timeoutMs`, `maxBytes`, `contexts`, `legacyProofs`, `suites` and `maxJsonLdTokens`, and
`verifyProof` refuses `algorithms`, `fetch`, `timeoutMs` and `maxBytes`, which each had read and ignored. `verifyCredentialStatus`
and `verifyCredential` refuse `cache`, the old name of `statusLists`, and a misspelling such as `maxEndorsement`; `recipient` of
`verifyCredential` takes `id` and `identifier` (`type` and `value`) and refuses any other property. `createContextLoader`,
`createKeyResolver`, `verifyIssuerKey`, `signCredentialJwt`, `addProof`, `deriveDisclosure`, `validateJsonLd`, `createStatusList`,
`allocateStatusIndex`, `issueStatusListCredential`, `createStatusListCache`, `refreshCredential` and `handleRefreshRequest` refuse
each option that is not in their `...Options` type, such as `fetch` for `signCredentialJwt` or `keys` for `refreshCredential`.
`issueStatusListCredential` checks `contexts` whichever proof it signs with, and `verifyIssuerKey` needs a `keys` with an
`issuerKeys` function. The message of a refused option names the options object and the path of the option, such as
`The options of createKeyResolver is invalid at ttlSeconds: expected a value of at least 1, found 0.`
