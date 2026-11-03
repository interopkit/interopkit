---
"@interopkit/tool-integration": major
---

Every function is named by what it does, with one verb for one meaning: `buildDeepLinkingResponse` (was `createDeepLinkResponse`), `buildRegistrationClosePage` (was `createRegistrationClosePage`), `buildRegistrationInitiation` (was `createRegistrationInitiation`), `buildStartAssessmentPage` (was `createStartAssessmentPage`), `handleLaunch` (was `ltiLaunch`), `handleLogin` (was `ltiLogin`), `prepareToolFrame` (was `ltiPlatformFrame`), `prepareToolLaunch` (was `ltiPlatformLogin`), `buildPlatformRegistration` (was `toPlatformRegistration`) and `buildToolRegistration` (was `toToolRegistration`). A function that reads or writes a form that a standard defines is named `read` or `write`, one that assembles plain data `build`, one that returns an object with behavior `create`, one that answers an HTTP request `handle`, a lookup `find` or `list`, a predicate `is`, and no old name is kept as an alias.

The parameter `nowMilliseconds` of `advanceScoreTimestamp` is `nowMs`, with the unit abbreviated as `timeoutMs` is.
