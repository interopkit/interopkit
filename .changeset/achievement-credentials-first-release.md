---
"@interopkit/achievement-credentials": minor
---

The model of Open Badges 3.0 and CLR 2.0: the credentials (`AchievementCredential`, `EndorsementCredential`,
`ClrCredential`, `VerifiableCredential`) under the Verifiable Credentials Data Model 2.0 and 1.1, their subjects, profiles,
achievements, results, alignments, evidence and proofs, the answers of the APIs, `ImsxStatusInfo`, the service description,
keys and the CLR payloads of a JWT, with the vocabularies and their `ext:` terms. `readCredential` and `readEntity` check a
value against the JSON schemas of 1EdTech and the rules of the subject, and return a copy in which a list that the compacted
form of JSON-LD writes as its only member is a list; they throw a `DataError` that names the path of the first error and counts
the others. `validateCredential` and `validateEntity` return the findings, at most `maxFindings` (1,000) of them, with their path, rule,
sentence and severity, as data, among them `subject-unidentified` and `identity-hash-form`.

`buildAchievementCredential`, `buildEndorsementCredential` and `buildClrCredential` write the contexts, the types, the subject
and the official `credentialSchema` around the parts that an issuer gives, check the result as the readers do, and throw a
`DataError` that names every fault; `buildClrCredential` writes the payload of a CLR in a JWT when its credentials are compact
JWS. `caseAlignment` aligns an achievement to a CASE item. `hashIdentifier` writes the `sha256$` hash of a recipient's
identity and `matchesIdentifier` matches an `IdentityObject` of 3.0 or of a 2.0 assertion with a known identity, in `sha256$`
and `md5$`. `sameCredential` and `newerCredential` compare credentials as Open Badges 10 asks, and `credentialSummary` gives what
a wallet shows of a badge, a CLR or an endorsement under either data model.

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
to the issuer; it refuses a base proof. `createContextLoader` serves a JSON-LD context only after its document matches the pin of its
address (`KNOWN_CONTEXTS` pins those of Verifiable Credentials, Open Badges, CLR, Data Integrity, Multikey and DID), and every
processor of JSON-LD loads contexts through it and no other way. `validateJsonLd` lists what safe mode would drop. The builders write
the context of the 1EdTech extensions, so that a built credential survives safe mode.

`createStatusList`, `allocateStatusIndex`, `setCredentialStatus` and `issueStatusListCredential` make a Bitstring Status List and the
credential that holds it, as a compact JWS or with a Data Integrity proof; `verifyCredentialStatus` follows its validate algorithm
and reports each failure by its code, reads an entry of the `message` purpose or wider than one bit as `skipped`, inflates the
list through a stream that stops at 16,777,216 bytes, and binds the key of the list credential to its issuer; `createStatusListCache`
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
`credentialSummary` shows a 2.0 assertion as `badge-v2`, and `matchesIdentifier` matches its recipient of `IDENTITY_TYPES_V2`
in `sha256$` and `md5$`. A 2.0 badge is read and never written.

`@interopkit/achievement-credentials/verify` is `verifyCredential`: it verifies a credential, an endorsement or a CLR (as an object, a
compact JWS, or what `readPng` and `readSvg` return) as Open Badges 9 and CLR 8 say, and returns every check (`format`,
`schema`, `proof`, `issuer`, `refresh`, `status`, `validity`, `recipient`) with its outcome and a detail, always in that order. The key
of every proof must belong to its issuer, for the credential, for each endorsement and credential of a CLR, and for a status list;
nothing that a credential names is fetched before its proof is valid; a schema other than 1EdTech's is fetched once for the call and
refused when it runs a regular expression; a refreshed credential must be authentic and the same credential. `unavailable` says
whether a status list, a refresh, a schema or an issuer's keys that cannot be read fail the verification, and a proof that cannot
be checked always does. A credential has at most `maxEndorsements` (32) endorsements and a CLR `maxNestedCredentials` (1,000)
credentials, and the input is limited in characters, tokens and levels before it is parsed.

A credential with a Data Integrity proof is also limited for what a JSON-LD processor reads, because the work of a processor grows
with the square of the values of one property: `addProof`, `deriveDisclosure`, `verifyProof`, `validateJsonLd` and
`verifyCredential` take `maxJsonLdTokens` (20,000 by default) and refuse a credential over it before any processor reads it, and
the canonicalization of the cryptosuites stops after 1,000 runs of Hash N-Degree Quads, as in `selective-disclosure`. `verifyProof`
checks the first four proofs of a credential and canonicalizes the credential once for all of them. A limit is the reason of the
`proof` check and not a signature that fails. A `DataIntegritySuite` is given the credential without its proof and the limits that
the glue checked (`maxBytes`, `maxTokens`), and a `DataError` that it rejects with becomes that reason.
