---
"@interopkit/achievement-credentials": major
---

The model of Open Badges 3.0 and CLR 2.0: the credentials (`AchievementCredential`, `EndorsementCredential`,
`ClrCredential`, `VerifiableCredential`) under the Verifiable Credentials Data Model 2.0 and 1.1, their subjects, profiles,
achievements, results, alignments, evidence and proofs, the answers of the APIs, `ImsxStatusInfo`, the service description,
keys and the CLR payloads of a JWT, with the vocabularies and their `ext:` terms. `readCredential` and `readEntity` check a
value against the JSON schemas of 1EdTech and the rules of the subject, and return a copy in which a list that the compacted
form of JSON-LD writes as its only member is a list; they throw a `DataError` that names the path of the first error and counts
the others. `validateCredential` and `validateEntity` return the findings, at most `maxFindings` (1,000) of them, with their path, rule,
sentence and severity, as data, among them `subject-unidentified`, `subject-empty`, `validity-period`, `identity-hash-form`, the
forms of a `relatedResource` (`related-resource-form`, `related-resource-id`, `related-resource-duplicate`,
`related-resource-digest`), and the warnings `result-description-unknown`, `achieved-level-unknown`, `result-status-missing` and
`criteria-undescribed`.

`buildAchievementCredential`, `buildEndorsementCredential` and `buildClrCredential` write the contexts, the types, the subject
and the official `credentialSchema` around the parts that an issuer gives, check the result as the readers do, and throw a
`DataError` that names every fault; `buildClrCredential` writes the payload of a CLR in a JWT when its credentials are compact
JWS. `caseAlignment` aligns an achievement to a CASE item. `hashIdentifier` writes the `sha256$` hash of a recipient's
identity and `matchesIdentifier` matches an `IdentityObject` of 3.0 or of a 2.0 assertion with a known identity, in `sha256$`
and `md5$`. `sameCredential` and `newerCredential` compare credentials of either data model as Open Badges 10 asks, by `validFrom` or `issuanceDate`, and `credentialSummary` gives what
a wallet shows of a badge, a CLR or an endorsement under either data model, with the date it was awarded.

`@interopkit/achievement-credentials/baking` writes a credential into a PNG or an SVG image and reads it out. `bakePng` and
`bakeSvg` take a compact JWS or a credential with an embedded proof, choose `openbadgecredential` or `clrcredential` (and the
namespaces of Open Badges and CLR) from its type, refuse an image that holds a credential unless `replace` is set, and leave
every other chunk or character as it was. `readPng` and `readSvg` return the kind and the credential of the first chunk or
element, or `undefined`, and refuse a damaged or compressed chunk, an SVG that nests more than 256 elements or has more than 256
attributes in one, and a credential of more than `maxTokens` (1,000,000) tokens of JSON.

`@interopkit/achievement-credentials/client` is the client of the Open Badges API and the CLR Standard API. `discoverService`
reads the service description of a server into the endpoints of its authorization code flow, its scopes and its policies, for
the OAuth clients of `@interopkit/core/oauth`. `createCredentialsClient` lists the credentials of a user page by page as objects
and compact JWS (`listCredentials`, from `X-Total-Count`, `Link` or the size of a page, with `since`), adds or replaces one
(`upsertCredential`, which says `"created"`, `"replaced"` or `"unchanged"`), and reads and replaces the profile. Its access tokens
come from a function of the host, it follows no redirect, and it retries nothing: `readStatusInfo` gives the `imsx_StatusInfo`
and the `Retry-After` of a refusal. A page of more credentials than the request asked for, and an answer of more than `maxTokens`
tokens, are refused before they are read. `readEntity` returns the class of its kind.

`createKeyResolver` resolves the key of a `kid` or a verification method from a `did:key`, a `did:web` or an HTTPS address (a
JWK, a Multikey, a key set, a DID or controller document), caches the documents with a shared load, and reads what an issuer
publishes: its document, the key set at `/.well-known/jwks.json` and a `did:jwk`. `verifyIssuerKey` checks that a key belongs to
the issuer that a credential names, by thumbprint, `controller` and `iss`, and returns the `issuer` check. `signCredentialJwt`
signs a credential over a `Signer` as Open Badges 8.2 asks, with a CLR's nested credentials as compact JWS, and
`readCredentialJwt` verifies a compact JWS of the Open Badges form, the VC-JOSE-COSE form or the `vc` claim form of VC-JWT 1.1,
checks its claims against the credential, and refuses a key that the issuer does not publish unless `allowUnboundKeys` is set.
The package needs Node.js 24 or later.

`addProof` signs a credential with `eddsa-rdfc-2022`, or writes the base proof of `ecdsa-sd-2023`, over a `Signer`; `deriveDisclosure`
derives a disclosure from a base proof, and `verifyProof` verifies the Data Integrity proofs of a credential (`eddsa-rdfc-2022`,
`ecdsa-rdfc-2019`, `ecdsa-sd-2023` and, on request, `Ed25519Signature2020`, or the suites that a host passes), with the key bound
to the issuer; it verifies a proof set and a proof chain (`previousProof`) as Verifiable Credential Data Integrity 1.0 asks,
prefers a proof by a key of the issuer to that of a witness, and refuses a base proof. `createContextLoader` serves a JSON-LD context only after its document matches the pin of its
address (`KNOWN_CONTEXTS` pins those of Verifiable Credentials, Open Badges, CLR, Data Integrity, Multikey and DID), and every
processor of JSON-LD loads contexts through it and no other way. `validateJsonLd` lists what safe mode would drop. The builders write
the context of the 1EdTech extensions, so that a built credential survives safe mode.

`createStatusList`, `allocateStatusIndex`, `setCredentialStatus` and `issueStatusListCredential` make a Bitstring Status List and the
credential that holds it, as a compact JWS or with a Data Integrity proof; `verifyCredentialStatus` follows its validate algorithm
and reports each failure by its code, reads an entry of the `message` purpose or wider than one bit as `skipped`, inflates the
list once through a stream that stops at 16,777,216 bytes, judges the validity of the list within `clockSkewSeconds`, binds the
key of the list credential to its issuer, and reads a `1EdTechRevocationList` entry of the Revocation List Status Method; `createStatusListCache`
keeps list credentials until their `ttl` or `validUntil`. `refreshCredential` gets the newer version of a credential from its
`1EdTechCredentialRefresh` service and `handleRefreshRequest` answers as that service for an issuer.

Every function that parses text that a source chose (a key document, a JWS, a context, a status list, a refreshed credential, a
baked credential) counts its tokens and levels first and takes `maxTokens`, 1,000,000 by default, so that a text of megabytes is
refused before `JSON.parse` builds anything. The vectors of the EdDSA and ECDSA Recommendations and of `did:key` are run through the
functions: the proof of `eddsa-rdfc-2022` equals the published one byte for byte.

`readCredential` and `validateCredential` also read Open Badges 2.0: an assertion under `https://w3id.org/openbadges/v2`, alone
or in a list of contexts as the validator of 1EdTech reads it, that embeds its BadgeClass and issuer, or the three documents as a `BadgeAssertionV2`, with the aliases `verify`, `hosted` and
`signed` of the context written as their terms, the classes of 2.0 (`AssertionV2`, `BadgeClassV2`, `ProfileV2`,
`IdentityObjectV2`, `VerificationObjectV2`, `CryptographicKeyV2`, `RevocationListV2` and the rest) and their rules, among them
`not-embedded`, `unlinked-document`, `duplicate-term`, `redefined-term`, `unknown-term`, `identity-hash-form` and
`expiry-before-issue`. `AnyCredential` holds
`BadgeAssertionV2` beside `AnyVerifiableCredential`, and `readCredential` with a `kind` returns an `AnyVerifiableCredential`.
`readPng` and `readSvg` find a 2.0 assertion as Open Badges 2.0 Baking writes it, kind `badge-v2`: JSON or a compact JWS in an
`iTXt` chunk `openbadges`, the address of a hosted assertion in a legacy `tEXt` chunk, or an `assertion` element of
`http://openbadges.org`; the bakers refuse a 2.0 assertion. `credentialSummary` shows a 2.0 assertion as `badge-v2`, and `matchesIdentifier` matches its recipient of `IDENTITY_TYPES_V2`
in `sha256$` and `md5$`. A 2.0 badge is read and verified, and never written.

`@interopkit/achievement-credentials/verify` is `verifyCredential`: it verifies a credential, an endorsement or a CLR (as an object, a
compact JWS, or what `readPng` and `readSvg` return) as Open Badges 9 and CLR 8 say, and returns every check (`format`,
`schema`, `proof`, `issuer`, `refresh`, `status`, `validity`, `recipient`) with its outcome and a detail, always in that order. The key
of every proof must belong to its issuer, for the credential, for each endorsement and credential of a CLR, and for a status list;
nothing that a credential names is fetched before its proof is valid; a schema other than 1EdTech's is fetched once for the call,
at most 4 of them, refused when it runs a regular expression, and judged within a bound of work; a refreshed credential must be
authentic, bound to its issuer and the same credential, and one verification follows at most 16 refreshes. `unavailable` says
whether a status list, a refresh or a schema that cannot be read fails the verification; a proof that cannot be checked and
issuer keys that cannot be read always do. The endorsements are those that the credential holds anywhere: its own, its issuer's
and its parent organizations', its achievements' and their creators'. A credential has at most `maxEndorsements` (32) endorsements and a CLR `maxNestedCredentials` (1,000)
credentials, and the input is limited in characters, tokens and levels before it is parsed. A `KeyResolver`, a loader of contexts or a suite of the host that never answers does not hold a verification, a proof or a signature past its `signal`.

`verifyCredential` also verifies an Open Badges 2.0 badge as its Verification section says, from the address of a hosted assertion,
an assertion or a `BadgeAssertionV2`, a compact JWS or what `readPng` and `readSvg` return. A hosted assertion is fetched at its
`id`, revoked when its host answers 410 Gone or `revoked: true`, and must be within the `startsWith` and `allowedOrigins` of its
issuer. A signed assertion is verified with its `creator`, or the first 8 keys of its issuer, which must list the key and own it,
and then checked against the issuer's `revocationList`. The BadgeClass and the issuer are fetched from their HTTPS `id`; every fetch
is HTTPS to a public host name (`checkRemoteUrl`) through the host's `fetch`, with no redirect and within `timeoutMs`, `maxBytes`, `maxTokens` and `maxDepth`; an issuer
that is not at an HTTPS address fails the `issuer` check; and the revocation list is fetched only once the signature verifies.

A credential with a Data Integrity proof is also limited for what a JSON-LD processor reads, because the work of a processor grows
with the square of the values of one property: `addProof`, `deriveDisclosure`, `verifyProof`, `validateJsonLd` and
`verifyCredential` take `maxJsonLdTokens` (20,000 by default) and refuse a credential over it before any processor reads it, and
the canonicalization of the cryptosuites stops after 1,000 runs of Hash N-Degree Quads, as in `selective-disclosure`. `verifyProof`
checks at most four proofs of a credential, those of a chain among them. A limit is the reason of the `proof` check and not a
signature that fails. A `DataIntegritySuite` is given the document that the proof secures and the limits that the glue checked
(`maxBytes`, `maxTokens`), and a `DataError` that it rejects with becomes that reason.

`@interopkit/achievement-credentials/provider` is the resource server of the Open Badges API and the CLR Standard API:
`handleCredentialsRequest` answers `getCredentials` with `limit`, `offset` and `since`, the objects in `credential` and the compact
JWS in `compactJwsString`, `X-Total-Count` when the store counts and `Link`; `upsertCredential` as JSON or a compact JWS, read as
the credential of the API and answered 201, 200 or 304 as the `CredentialStore` decides; `getProfile` and `putProfile` over a
`ProfileStore`; and the service description, unprotected, which it checks offers every scope of the API. Each operation asks the
host's `authorize` for its scope and the owner of the token (`CredentialsAccess`), and a refusal is 401, 403 with
`insufficient_scope` or 429 with `Retry-After`. With `verify`, a credential is verified before it is stored, without following its
refresh service, and refused with 422 when it does not verify. A body has at most `maxBodyBytes` (1,048,576) and `maxTokens`
(1,000,000), and every failure is an `imsx_StatusInfo` with the code of Open Badges B.3.6.

`createStatusListCache` keeps a list by its address and by the trust of the call that verified it (its `keys`, `contexts` and
`suites`, and `allowUnboundKeys`, `legacyProofs`, `algorithms` and `clockSkewSeconds`), so verifiers of different policies may share
one cache, and a load that calls share runs with no caller's signal; a list credential under the Data Model 1.1 is valid, and
kept, until its `expirationDate`. A hosted 2.0 assertion is held to the `startsWith` of its issuer at the address that `URL`
resolves. The `basePath` of the provider is compared percent-encoded, as `URL` writes the path of a request. The client, the
refresh handler and `addProof` stop waiting for a function of the host when the signal aborts, and the list of the client keeps a
digest of each credential that it has given. `validateJsonLd` and `deriveDisclosure` refuse a credential that nests more than 64
levels with a `DataError`.
