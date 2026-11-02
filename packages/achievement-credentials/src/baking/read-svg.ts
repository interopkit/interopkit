import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import type { BakedCredential } from "./baked-credential.js";
import { bakedJson, bakedJws } from "./credential-text.js";
import { checkTextSize, limitsOf, type ReadImageOptions } from "./options.js";
import { scanSvg } from "./svg-scan.js";

/**
 * Reads what the `assertion` element of Open Badges 2.0 holds: the JSON of an assertion when it has a body, else in its `verify`
 * attribute a compact JWS or the address of a hosted assertion (Open Badges 2.0 Baking). A body wins over the attribute, which
 * may then repeat the address of the assertion.
 */
function assertionV2Of(verify: string | undefined, body: string, maxTokens: number): string | object {
  if (body !== "") return bakedJson(body, maxTokens);
  const value = (verify ?? "").trim();
  if (/^https?:\/\/\S+$/u.test(value) && URL.canParse(value)) return value;
  if (value !== "") return bakedJws(value);
  throw new DataError("The assertion element of the SVG holds no assertion: no body, and no verify attribute.");
}

/**
 * Reads the credential that an SVG image holds: the first `credential` element in the namespace of Open Badges
 * (`https://purl.imsglobal.org/ob/v3p0`) or of CLR (`https://purl.imsglobal.org/clr/v2p0`), or `assertion` element of Open
 * Badges 2.0 (`http://openbadges.org`), whatever its prefix. A compact JWS is in its `verify` attribute, and the JSON of a
 * credential with an embedded proof is in its text; a 2.0 element holds JSON in its text, else a compact JWS or the address of a
 * hosted assertion in `verify`.
 *
 * @remarks
 * The result is what the image holds and nothing has checked it: a compact JWS is text, and JSON is an object. The image is
 * refused before any of it is parsed when it has more than `maxBytes`. The parser stops at the end of the first credential
 * element and reads nothing after it, so a fault later in the document is not found. The parser builds an object for each open
 * element and keeps the attributes of a tag until it ends, so an image that nests more than 256 elements or has more than 256
 * attributes in one element is refused. It resolves no entity but the five of XML and reads no DTD.
 *
 * @param svg - The text of the SVG.
 * @param options - The most bytes of the image.
 * @returns The credential and its kind, or `undefined` when the image holds none.
 * @throws `DataError` when the image is larger than the limit, is not well-formed XML before the credential, exceeds the
 * limits of nesting and attributes, or holds a credential element that is empty, holds an element, or is neither a compact JWS
 * nor valid JSON.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#baked-badge | Open Badges 3.0, Baked Badge}
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/main/#image-format | CLR 2.0, Image Format}
 * @see {@link https://www.imsglobal.org/sites/default/files/Badges/OBv2p0Final/baking/index.html | Open Badges 2.0 Baking}
 */
export function readSvg(svg: string, options?: ReadImageOptions): BakedCredential | undefined {
  const { maxBytes, maxTokens } = limitsOf(options, ["maxBytes", "maxTokens"]);
  if (typeof svg !== "string") throw new DataError(`The image must be a string, found ${describe(svg)}.`);
  checkTextSize(svg, maxBytes, "The image");
  const [element] = scanSvg(svg, false).credentials;
  if (element === undefined) return undefined;
  const body = element.text.trim();
  if (element.kind === "badge-v2")
    return { kind: "badge-v2", credential: assertionV2Of(element.verify, body, maxTokens) };
  if (element.verify !== undefined) {
    if (body !== "")
      throw new DataError("The credential element of the SVG has a verify attribute and text. It may have one.");
    return { kind: element.kind, credential: bakedJws(element.verify) };
  }
  if (body === "") throw new DataError("The credential element of the SVG holds no credential.");
  return { kind: element.kind, credential: bakedJson(body, maxTokens) };
}
