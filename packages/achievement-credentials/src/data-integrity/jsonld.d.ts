declare module "@interop/jsonld" {
  /** The part of the JSON-LD processor that the package calls. */
  const jsonld: {
    expand(
      input: unknown,
      options: {
        readonly documentLoader: (url: string) => Promise<unknown>;
        readonly eventHandler?: (handled: {
          readonly event: { readonly message?: unknown; readonly details?: unknown };
        }) => void;
      },
    ): Promise<unknown[]>;
  };
  // biome-ignore lint/style/noDefaultExport: the library has no other export, and this declares it.
  export default jsonld;
}
