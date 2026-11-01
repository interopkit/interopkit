---
"@interopkit/achievement-credentials": minor
---

The model of Open Badges 3.0 and CLR 2.0: the credentials (`AchievementCredential`, `EndorsementCredential`,
`ClrCredential`, `VerifiableCredential`) under the Verifiable Credentials Data Model 2.0 and 1.1, their subjects, profiles,
achievements, results, alignments, evidence and proofs, the answers of the APIs, `ImsxStatusInfo`, the service description,
keys and the CLR payloads of a JWT, with the vocabularies and their `ext:` terms. `readCredential` and `readEntity` check a
value against the JSON schemas of 1EdTech and the rules of the subject, and return a copy in which a list that the compacted
form of JSON-LD writes as its only member is a list; they throw a `DataError` that names the path of the first error and counts
the others. `validateCredential` and `validateEntity` return every finding, with its path, rule, sentence and severity, as
data, among them `subject-unidentified` and `identity-hash-form`.

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
attributes in one, and a credential of more than 1,048,576 characters.
