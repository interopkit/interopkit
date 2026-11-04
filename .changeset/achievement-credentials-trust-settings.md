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
