import { parseWith, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { CASE_VERSIONS, type CaseVersion, SERVED_KINDS, type ServedKind } from "../model/index.js";
import { checkEndpointIdentifier, endpointUrl, serviceRoot } from "../model/internal.js";

/** What `caseEntityUri` may be asked. */
export interface CaseEntityUriOptions {
  /**
   * The version of CASE whose path the address has. The Implementation Guide asks for the latest version that the publisher
   * supported when the entity was last saved.
   *
   * @defaultValue `"1.1"`
   */
  readonly version?: CaseVersion;
}

const kindSchema = v.picklist(SERVED_KINDS);
const optionsSchema = strictRecord({ version: v.optional(v.picklist(CASE_VERSIONS)) });

/**
 * Builds the `uri` that an entity should have: the address at which the REST binding of CASE serves it.
 *
 * @remarks
 * The Implementation Guide 4.1 recommends that the `uri` of every entity is the address from which a consumer retrieves it
 * from its source of truth, so that a consumer can ask whether a copy is out of date. The collection is the name of the class
 * in the plural, as the REST binding names its endpoints.
 *
 * @param baseUrl - The address of the service before the path of the version, such as `https://standards.example.org`. It is
 * an `https` URL without credentials, query or fragment.
 * @param kind - The class of the entity.
 * @param identifier - The identifier of the entity, which the path carries percent-encoded.
 * @param options - The version of the path.
 * @returns The address, such as `https://standards.example.org/ims/case/v1p1/CFItems/2b6d1c9e-7a53-4e08-b1f4-5c8a9d0e3f21`.
 * @throws `DataError` when an argument is not valid.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1/impl | CASE Implementation Guide}, 4.1
 */
export function caseEntityUri(
  baseUrl: string,
  kind: ServedKind,
  identifier: string,
  options?: CaseEntityUriOptions,
): string {
  const { version = "1.1" } = parseWith(optionsSchema, options === undefined ? {} : options, "The options");
  const root = serviceRoot(baseUrl, version, "The base URL");
  const checkedKind = parseWith(kindSchema, kind, "The kind");
  checkEndpointIdentifier(identifier, "The identifier");
  return endpointUrl(root, `${checkedKind}s`, identifier);
}
