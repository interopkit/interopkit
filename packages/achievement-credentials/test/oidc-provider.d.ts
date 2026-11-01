/** The part of `oidc-provider`, which ships no types, that the counterparty test uses. */
declare module "oidc-provider" {
  import type { IncomingMessage, ServerResponse } from "node:http";

  /** An OAuth 2.0 and OpenID Connect authorization server, as a Koa application. */
  // biome-ignore lint/style/noDefaultExport: the package exports its class as the default.
  export default class Provider {
    constructor(issuer: string, configuration: Readonly<Record<string, unknown>>);
    /** Whether to trust the `X-Forwarded-*` headers for the address that the server sees. */
    proxy: boolean;
    /** The handler of a Node.js HTTP server. */
    callback(): (request: IncomingMessage, response: ServerResponse) => void;
  }
}
