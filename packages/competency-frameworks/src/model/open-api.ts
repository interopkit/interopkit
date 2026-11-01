/**
 * An OpenAPI 3 document, such as the file of 1EdTech that a provider localizes for service discovery (REST binding 2.5):
 * `openapi`, `info` and `paths` are checked, and the rest is carried as it is.
 */
export interface OpenApiDocument {
  /** The version of OpenAPI that the document is written in, such as `3.0.0`. */
  readonly openapi: string;
  /** The title and version of the API that the document describes. */
  readonly info: Readonly<Record<string, unknown>>;
  /** The paths of the API and the operations at each. */
  readonly paths: Readonly<Record<string, unknown>>;
  /** The rest of the document: `servers`, `components` and the like. */
  readonly [key: string]: unknown;
}
