import "vitest";

declare module "vitest" {
  interface ProvidedContext {
    /** The origins of the servers that the browser tests post to and receive messages from. */
    fixtures: { readonly other: string; readonly stranger: string; readonly hostile: string };
  }
}
