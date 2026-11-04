---
"@interopkit/tool-integration": major
---

A form over `maxFormBytes` and a Deep Linking response over `maxContentItems` throw `LimitError` of `@interopkit/core`, which a host answers with 413, in place of an `LtiError` with the reasons `form-too-large` and `content-items-limit`, which are gone; the services of the platform answer 413 for JSON over its levels or tokens, and an answer of a client over `maxTokens` is a `LimitError`. `LtiError` takes `ErrorOptions`, and one that reports another error carries it as its `cause`.
