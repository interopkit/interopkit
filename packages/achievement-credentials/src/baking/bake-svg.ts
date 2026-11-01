import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { textToBake } from "./credential-text.js";
import { CREDENTIAL_ELEMENT, FORMATS, SVG_NAMESPACE, VERIFY_ATTRIBUTE } from "./formats.js";
import { type BakeImageOptions, checkTextSize, limitsOf } from "./options.js";
import { scanSvg } from "./svg-scan.js";

/** The two characters that XML 1.0 forbids and JSON leaves as they are. Written as `\u` escapes, they mean the same in JSON. */
const FORBIDDEN_IN_XML = /[￾￿]/gu;

/** A change of the text: what replaces the characters from `start` to `end`. */
interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Wraps the JSON in a CDATA section, splitting any `]]>` in it, which would end the section. */
function cdata(json: string): string {
  const escaped = json.replace(FORBIDDEN_IN_XML, (mark) => `\\u${mark.charCodeAt(0).toString(16)}`);
  return `<![CDATA[${escaped.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

/**
 * Bakes a credential into an SVG image: adds the namespace to the `svg` element and a `credential` element right after its
 * start tag, and leaves every other character as it was.
 *
 * @remarks
 * The kind follows the credential's `type`, and for a compact JWS the `type` in its payload: Open Badges use the prefix
 * `openbadges` in `https://purl.imsglobal.org/ob/v3p0`, and a CLR uses `clr` in `https://purl.imsglobal.org/clr/v2p0`. A compact
 * JWS goes in the `verify` attribute, and the JSON of a credential goes in the element, in a CDATA section. When the `svg`
 * element already binds the prefix to another namespace, such as the one of Open Badges 2.0, the declaration goes on the new
 * element. An object is checked with `readCredential` first, and a compact JWS only for its shape: baking verifies nothing. The
 * whole image is parsed, so it must be well-formed, and the limits of `readSvg` hold. The image and the result are refused
 * above `maxBytes`.
 *
 * @param svg - The text of the SVG.
 * @param credential - A compact JWS, or a credential that is not signed as an object.
 * @param options - Whether to replace the credential that the image already holds, and the most bytes of the image.
 * @returns The baked image.
 * @throws `DataError` when the image is not an SVG that is well-formed, the credential is not valid, the image holds a
 * credential and `replace` is `false`, or the image or the result is larger than `maxBytes`.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#baked-badge | Open Badges 3.0, Baked Badge}
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/main/#image-format | CLR 2.0, Image Format}
 */
export function bakeSvg(svg: string, credential: string | object, options?: BakeImageOptions): string {
  const { maxBytes, replace } = limitsOf(options, ["maxBytes", "replace"]);
  if (typeof svg !== "string") throw new DataError(`The image must be a string, found ${describe(svg)}.`);
  checkTextSize(svg, maxBytes, "The image");
  const { kind, text, signed } = textToBake(credential);
  const { root, credentials } = scanSvg(svg, true);
  if (root.uri !== SVG_NAMESPACE || root.local !== "svg") {
    throw new DataError(
      `The image is not an SVG: its root element is ${root.name}, not svg in the namespace ${SVG_NAMESPACE}.`,
    );
  }
  if (credentials.length > 0 && !replace) {
    throw new DataError("The SVG image already holds a credential. Pass the option replace to replace it.");
  }
  const { prefix, namespace } = FORMATS[kind];
  const bound = root.bindings[prefix];
  const declaration = ` xmlns:${prefix}="${namespace}"`;
  // A prefix that the root binds elsewhere is rebound on the element, so that the root's own uses of it stay as they are.
  const own = bound !== undefined && bound !== namespace ? declaration : "";
  const name = `${prefix}:${CREDENTIAL_ELEMENT}`;
  const element = `<${name}${own}${signed ? ` ${VERIFY_ATTRIBUTE}="${text}"` : ""}>${signed ? "" : cdata(text)}</${name}>`;
  const added = bound === undefined ? declaration : "";
  const edits: Edit[] = credentials.map(({ start, end }) => ({ start, end, text: "" }));
  if (root.selfClosing) {
    // `<svg/>` has no content to put the element in: it becomes `<svg>` with the element and an end tag.
    edits.push({ start: root.end - 2, end: root.end, text: `${added}>${element}</${root.name}>` });
  } else {
    edits.push(
      { start: root.end - 1, end: root.end - 1, text: added },
      { start: root.end, end: root.end, text: element },
    );
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let baked = "";
  let at = 0;
  for (const edit of edits) {
    baked += svg.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  baked += svg.slice(at);
  checkTextSize(baked, maxBytes, "The baked image");
  return baked;
}
