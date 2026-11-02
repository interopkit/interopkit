# A platform and a tool

A platform that launches a tool, and the tool that validates the launch, publishes a score through the grade services and answers
a Deep Linking request, in one process. The platform uses
the platform role of `@interopkit/tool-integration`, the tool uses the tool role, and both use `@interopkit/core`. They reach each
other through an in-memory network, so the example needs no server, and each handler is the one a host would route a request to.

```mermaid
sequenceDiagram
  participant H as Platform host
  participant B as Browser
  participant T as Tool
  participant P as Platform handlers
  H->>P: ltiPlatformFrame(message)
  P-->>H: login URL, storage URL; the message kept
  B->>T: login URL (ltiLogin)
  T-->>B: page: keep state and nonce in the platform's storage
  B->>P: authentication request (handlePlatformRequest)
  P-->>B: page: post the id_token
  B->>T: id_token and state (ltiLaunch)
  T-->>B: page: fetch the stored values
  B->>T: id_token, state and the stored values
  T->>P: the key set, a token, the line item, the score, the results (handlePlatformRequest)
  P->>H: GradebookStore: lineItem, keepScore, results
  H->>P: ltiPlatformFrame(LtiDeepLinkingRequest)
  B->>T: the same login and launch
  T-->>B: createDeepLinkResponse: page that posts the signed JWT to the return URL
  B->>H: POST JWT to the host's route
  H->>P: readDeepLinkingResponse: the items and the data of the host
```

| File              | Holds                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/platform.ts` | `createPlatform`: one handler for the platform's origin, with the route at the return URL of Deep Linking, and the frame of a message     |
| `src/tool.ts`     | `createTool`: one handler for the tool's routes, which answers a Deep Linking request, and the grading of a launch through `createServiceClient` |
| `src/network.ts`  | `connect`: a `fetch` that reaches the handler of an origin, and `plainRequest`                                                            |
| `src/platform-setup.ts` | The platform's keys, its registration of the tool, its store of launches, its ledger of single-use identifiers and its gradebook   |
| `src/gradebook.ts` | A `GradebookStore` in memory, which keeps a score unless a later one is kept                                                            |
| `src/tool-setup.ts` | The tool's registration of the platform, its store of logins and its key set cache                                                      |
| `src/keys.ts`     | The keys that each side generates for itself: RS256 for the tool, ES256 and HMAC for the platform                                         |
| `scenario.ts`     | `runScenario`: the steps of the browser, and what each side saw                                                                           |
| `test/`           | The tests, which CI runs                                                                                                                  |

## Rules of the example

| Rule                      | Value                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Keys                      | Generated at each run with Web Crypto; the platform has the tool's public key, not a URL of the tool's key set                          |
| Time                      | A fixed `Clock`, so that the tokens of both sides agree                                                                                 |
| Single use                | The platform's store of launches gives a message once: the same authentication request a second time gets `login_required`             |
| Where a real host differs | Its stores are shared across processes, its routes sit behind its own sessions, and the page of the client-side login runs in a browser |

To run the scenario, build the packages, then start it. It prints what each side saw:

```sh
pnpm build
pnpm --filter @interopkit/example-tool-integration start
```
