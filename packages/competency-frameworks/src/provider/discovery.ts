import { DataError } from "@interopkit/core";
import { copyJson, parseWith, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import type { OpenApiDocument } from "../model/index.js";
import { openApiSchema } from "../read/internal.js";

/** The options of `localizeOpenApi`. */
export interface LocalizeOpenApiOptions {
  /**
   * The address that the paths of the document are relative to: the root of the API at the provider, which ends with
   * `/ims/case/v1p1` (or `/ims/case/v1p0`), such as `https://case.example.org/ims/case/v1p1`.
   */
  readonly serverUrl: string;
}

/** The name of the discovery file of CASE 1.1 (REST binding 2.5). */
export const DISCOVERY_FILE = "imscasev1p1_openapi3_v1p0.json";

const optionsSchema = strictRecord({
  serverUrl: v.pipe(
    v.string(),
    v.check(
      (url) => /^https?:\/\/[^/?#\s]+(?:\/[^?#\s]*)?\/ims\/case\/v1p[01]$/u.test(url) && URL.canParse(url),
      (issue) =>
        `expected an http or https address that ends with /ims/case/v1p1, such as "https://case.example.org/ims/case/v1p1", found ${issue.received}`,
    ),
  ),
});

/**
 * Makes the OpenAPI file of 1EdTech into the localized file that a provider serves for service discovery (REST binding 2.5):
 * the `servers` of the document become the one address that the provider answers at.
 *
 * @param document - The OpenAPI 3 document of the CASE service, such as the file of 1EdTech.
 * @param options - Where the provider is.
 * @returns A copy of the document with `servers` set; it shares nothing with the input.
 * @throws `DataError` when the document is not an OpenAPI 3 document made of JSON that nests at most `MAX_JSON_DEPTH` levels,
 * or the address is not an http or https address that ends with the root of the API.
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/case/v1p1/rest_binding/caseservicev1p1_restbindv1p0.html | CASE REST binding 1.0, section 2.5}
 */
export function localizeOpenApi(document: OpenApiDocument, options: LocalizeOpenApiOptions): OpenApiDocument {
  const checked = parseWith(openApiSchema, document, "The OpenAPI document");
  const { serverUrl } = parseWith(optionsSchema, options, "The options");
  const copy = copyJson(checked, "");
  if ("problem" in copy) throw new DataError(`${copy.problem}.`);
  return parseWith(openApiSchema, { ...copy.value, servers: [{ url: serverUrl }] }, "The localized document");
}
