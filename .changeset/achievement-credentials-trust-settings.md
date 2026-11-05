---
"@interopkit/achievement-credentials": major
---

Every text of JSON that the package parses goes through `parseJsonText` of core, and every credential passed as an object is
counted in the same order: a text or a credential over both its limit of levels and its limit of tokens is refused for its
levels, a `LimitError` with `limit: "maxDepth"`, as every reader of the family refuses it. A refusal of the characters or the
tokens of a credential passed as an object names the option that sets them: `maxInputBytes`, `maxTokens` or `maxJsonLdTokens`.

A `did:jwk` and the `encodedList` of a status list are decoded as strictly as the parts of a JWS: the one canonical spelling of
their bytes in base64url, without padding. A `did:jwk` that is padded, or whose last character holds bits that no byte holds,
publishes no key, and such an `encodedList` fails the status check.

`readCredentialJwt`, `verifyProof`, `verifyCredentialStatus`, `refreshCredential` and `verifyCredential` read the options of a
verification with one check and its defaults, and `verifyCredential` hands what it checked to the checks of the proof, the
status and the refresh without checking it again. So an option of a verification that a function does not take is still refused
when its value is of the wrong type, and the functions agree where they differed: `verifyCredentialStatus` takes its cache of
list credentials as `statusLists`, the name that `verifyCredential` gives it (was `cache`); it refuses an empty issuer in
`statusIssuers`, and an algorithm outside those that verify a JWT before it reads the credential, as `verifyCredential` does;
and it takes `maxInputBytes`, `maxDepth` and `maxJsonLdTokens`, within which it verifies the list credential as every reader of a
credential does, and reads a revocation list within the same `maxDepth`. Its `signal` ends the fetch of a list that no cache shares. `verifyCredential` verifies each status list credential within its own `maxInputBytes`, `maxDepth` and
`maxJsonLdTokens`, as strictly as the credential.
