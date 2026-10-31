# Supported

What `@interopkit/tool-integration` implements of LTI 1.3: the tool role first, then the platform role. The package
implements these specifications and is not certified by 1EdTech. It claims no LTI Advantage conformance: the Names and Role
Provisioning Services are absent.

```mermaid
flowchart LR
  login["Third-party login<br/>+ client-side login"] --> launch["Launch<br/>id_token validation, claims"]
  launch --> dl["Deep Linking<br/>response"]
  launch --> ags["AGS<br/>access token, score"]
  launch -.-> missing["Not yet:<br/>NRPS, registration, proctoring,<br/>groups, review, PNP"]
```

| Area                                | Specification              | Tool role                                                                 | Not yet                                                                                                                                                                                |
| ----------------------------------- | -------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Third-party login                   | Core 4.1, Security 5.1.1   | `ltiLogin`: GET and POST, `lti_message_hint`, `client_id`                 | `lti_deployment_id` is ignored                                                                                                                                                         |
| Authentication request and response | Security 5.1.1             | State cookie, or the platform's storage                                   | An authentication error response from the platform is not read                                                                                                                         |
| Token validation                    | Security 5.1.3, 5.4        | Signature, `iss`, `aud`, `azp`, `exp`, `iat`, `nonce`, `kid`              | A list of trusted audiences: a second audience is refused                                                                                                                              |
| Algorithms                          | Security 7.2               | RS256                                                                     | RS384, RS512, ES256, ES384, ES512                                                                                                                                                      |
| Required claims                     | Core 5.3                   | `ltiLaunch`, with the message type, version and deployment                |                                                                                                                                                                                        |
| Anonymous launch                    | Core 5.3.6.1               | `subject` absent                                                          |                                                                                                                                                                                        |
| Optional claims                     | Core 5.4                   |                                                                           | `context`, `tool_platform`, `role_scope_mentor`, `launch_presentation`, `lis`                                                                                                          |
| User identity claims                | Core 5.3.6                 |                                                                           | Name, email, picture, locale                                                                                                                                                           |
| Vendor claims                       | Core 5.4.7                 |                                                                           | The launch exposes no raw claims                                                                                                                                                       |
| `target_link_uri`                   | Core 5.3.4                 | Reads the claim and returns it                                            | It is not compared with the login's value                                                                                                                                              |
| Roles                               | Core Appendix A            | Passed through as strings                                                 | The vocabulary of 38 IRIs                                                                                                                                                              |
| Custom properties                   | Core 5.4.6                 | A map of strings                                                          |                                                                                                                                                                                        |
| Key sets                            | Security 6.3, 6.4          | Reads the platform's with `createJwksCache`                               | Publishing the tool's own set                                                                                                                                                          |
| Service tokens                      | Core 6.2, Security 4.1     | `ltiAccessToken`, with the deployment claim; a token is never reused      |                                                                                                                                                                                        |
| Deep Linking request                | DL 4.4                     | Return URL, `accept_types`, `accept_multiple`, `data`                     | `accept_media_types`, `accept_presentation_document_targets`, `auto_create`, `title`, `text`, `accept_lineitem`                                                                        |
| Deep Linking response               | DL 3, 4.5                  | `ltiResourceLink` with title, text, url, custom, `lineItem`               | `link`, `file`, `html`, `image`, `gradesReleased` of a line item, extensions, `icon`, `thumbnail`, `window`, `iframe`, `available`, `submission`, `msg`, `log`, `errormsg`, `errorlog` |
| AGS claim                           | AGS 3.1                    | `ags` of the launch                                                       |                                                                                                                                                                                        |
| Line item service                   | AGS 3.2                    | One read for `scoreMaximum`                                               | Container, create, update, delete, filters, paging                                                                                                                                     |
| Result service                      | AGS 3.3                    |                                                                           | All                                                                                                                                                                                    |
| Score publish                       | AGS 3.4                    | `publishAgsScore`: `Completed`; `FullyGraded`, `Pending`, `PendingManual` | `scoringUserId`, `submission`, extensions                                                                                                                                              |
| Client-side login                   | OIDC with postMessages 0.1 | `lti.put_data` and `lti.get_data` pages                                   |                                                                                                                                                                                        |
| postMessage Storage                 | PM Storage 0.1             | The two pages                                                             |                                                                                                                                                                                        |
| Capabilities                        | postMessages 0.1           |                                                                           | The tool trusts `lti_storage_target`; `lti.capabilities` is not asked                                                                                                                  |
| Names and Role Provisioning         | NRPS 2.0                   |                                                                           | All                                                                                                                                                                                    |
| Dynamic Registration                | DR 1.0                     |                                                                           | All                                                                                                                                                                                    |
| Submission Review                   | SR 1.0                     |                                                                           | All; the request is refused as unsupported                                                                                                                                             |
| Proctoring                          | Proctoring 1.0             |                                                                           | All                                                                                                                                                                                    |
| Context Groups                      | Groups 1.0                 |                                                                           | All                                                                                                                                                                                    |
| AfA PNP connector                   | PNP Connector 1.0          |                                                                           | All                                                                                                                                                                                    |

## Platform role

```mermaid
flowchart LR
  login["ltiPlatformLogin<br/>ltiPlatformFrame"] --> authorize["ltiPlatformAuthorize<br/>id_token"]
  authorize --> token["platformJwks<br/>platformToken"]
  token --> ags["agsLineItem<br/>agsScores"]
  login -.-> storage["platformStorage"]
  authorize -.-> missing["Not yet:<br/>Deep Linking, NRPS, registration,<br/>proctoring, groups, review, PNP"]
```

| Area                                | Specification              | Platform role                                             | Not yet                                                                         |
| ----------------------------------- | -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Third-party login                   | Core 4.1, Security 5.1.1   | `ltiPlatformLogin`: all parameters, with two signed hints |                                                                                 |
| Authentication request and response | Security 5.1.1             | `ltiPlatformAuthorize`                                    | A refusal throws and never reaches the tool as an authentication error response |
| Client assertions                   | Security 5.1.3, 5.4        | Verified with RS256, against a key set or given keys      |                                                                                 |
| Algorithms                          | Security 7.2               | RS256                                                     | RS384, RS512, ES256, ES384, ES512                                               |
| Required claims                     | Core 5.3                   | `issueIdToken`, for a resource link launch                |                                                                                 |
| Anonymous launch                    | Core 5.3.6.1               |                                                           | `sub` is always the principal                                                   |
| Optional claims                     | Core 5.4                   |                                                           | `context`, `tool_platform`, `role_scope_mentor`, `launch_presentation`, `lis`   |
| User identity claims                | Core 5.3.6                 |                                                           | Name, email, picture, locale                                                    |
| Vendor claims                       | Core 5.4.7                 |                                                           | All                                                                             |
| `target_link_uri`                   | Core 5.3.4                 | The same value in the login and in the token              |                                                                                 |
| Roles                               | Core Appendix A            | The role of a learner                                     | The other 37 IRIs                                                               |
| Custom properties                   | Core 5.4.6                 | Copied from the launch                                    | Variable substitution: values pass unsubstituted                                |
| Key sets                            | Security 6.3, 6.4          | `platformJwks`: one key, with its thumbprint as `kid`     | A rotation overlap                                                              |
| Service tokens                      | Core 6.2, Security 4.1     | `platformToken`: two scopes, replay check of the `jti`    |                                                                                 |
| Deep Linking                        | DL 4.4, 4.5                |                                                           | Request and response                                                            |
| AGS claim                           | AGS 3.1                    | `lineitem`                                                | `lineitems`                                                                     |
| Line item service                   | AGS 3.2                    | `agsLineItem`: one line item, sealed in its own URL       | Container, create, update, delete, filters, paging                              |
| Result service                      | AGS 3.3                    |                                                           | All; the scope is not offered                                                   |
| Score publish                       | AGS 3.4                    | `agsScores`, `readAgsScore`: media type, user and values  | The order of timestamps is the receiver's                                       |
| Client-side login                   | OIDC with postMessages 0.1 | `platformStorage`                                         |                                                                                 |
| postMessage Storage                 | PM Storage 0.1             | The minimum limits, and `storage_exhaustion`              |                                                                                 |
| Capabilities                        | postMessages 0.1           |                                                           | `lti.capabilities` is answered by the host's page                               |
| Names and Role Provisioning         | NRPS 2.0                   |                                                           | All                                                                             |
| Dynamic Registration                | DR 1.0                     |                                                           | All                                                                             |
| Submission Review                   | SR 1.0                     |                                                           | All                                                                             |
| Proctoring                          | Proctoring 1.0             |                                                           | All                                                                             |
| Context Groups                      | Groups 1.0                 |                                                           | All                                                                             |
| AfA PNP connector                   | PNP Connector 1.0          |                                                           | All                                                                             |

Specifications whose text is behind a sign-in at 1EdTech (the Asset Processor family, EULA, Context Message, Data Privacy,
Rubric Service and others) are not assessed.