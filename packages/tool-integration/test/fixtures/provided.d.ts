import "vitest";

declare module "vitest" {
  interface ProvidedContext {
    /** The origins of the servers that the browser tests of the platform role post to. */
    fixtures: { readonly other: string; readonly stranger: string };
  }
}
