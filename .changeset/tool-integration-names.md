---
"@interopkit/tool-integration": major
---

Every function is named by what it does, with one verb for one meaning: `buildDeepLinkingResponse` (was `createDeepLinkResponse`), `buildRegistrationClosePage` (was `createRegistrationClosePage`), `buildRegistrationInitiation` (was `createRegistrationInitiation`), `buildStartAssessmentPage` (was `createStartAssessmentPage`), `handleLaunch` (was `ltiLaunch`), `handleLogin` (was `ltiLogin`), `prepareToolFrame` (was `ltiPlatformFrame`), `prepareToolLaunch` (was `ltiPlatformLogin`), `buildPlatformRegistration` (was `toPlatformRegistration`) and `buildToolRegistration` (was `toToolRegistration`). A function that reads or writes a form that a standard defines is named `read` or `write`, one that assembles plain data `build`, one that returns an object with behavior `create`, one that answers an HTTP request `handle`, a lookup `find` or `list`, a predicate `is`, and no old name is kept as an alias.

The parameter `nowMilliseconds` of `advanceScoreTimestamp` is `nowMs`, with the unit abbreviated as `timeoutMs` is.

`LtiError.reason` is a term of the exported union `LtiErrorReason`, so that a host can switch on it exhaustively. `RegistrationRefusal` is `{ reason, message }` where it was `{ refusal }`: the `reason` is `invalid_client_metadata` or `invalid_redirect_uri`, named by `RegistrationRefusalReason`, and the route answers 400 with the store's reason and message. An option `clock` that is left out is `SYSTEM_CLOCK`, for the tool role and for the platform role.

The custom properties are one type in every model and input: `custom` of `LtiMessage`, `LtiResourceLinkItem`, `SubmissionReview` and `customParameters` of `ToolConfiguration` and `ToolMessageConfiguration` are a `Readonly<Record<string, string>>` (were a `ReadonlyMap`), as `custom` of `MessageInput` and `ToolRegistration` already were. A property named `__proto__`, `constructor` or `prototype` is refused in all of them.

`prepareToolLaunch` is the one function that prepares a launch: it returns `{ url, storageUrl, storageTarget, toolFrame, allow? }`, and `prepareToolFrame` is gone. The names of the two frames are fixed, `lti-storage` and `lti-tool`, and returned there, so that the host's page names its frames from the result: the option `storageTarget` of `PlatformLoginOptions` and `toolFrame` of `PlatformRequestOptions` are gone, and are refused as unknown, and `buildCapabilitiesScript()` takes no options, so `CapabilitiesScriptOptions` is gone.

One port has one name across the package: the lookup of a tool by its client identifier is `registration` in `PlatformLoginOptions`, `PlatformRequestOptions` and `ToolMessageOptions` (`client` was the name in the last two), and the LTI 1.1 secret of a consumer key is `migrationSecret` in both roles (`legacySecret` was the name in `LtiLaunchOptions`).

The option `versions` of `handleLaunch` is gone: LTI 1.3 Core fixes the version claim at `1.3.0`, which `handleLaunch` checks, and any other value is `version-unsupported`.
