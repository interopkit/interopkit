import { DataError } from "@interopkit/core";
import { SaxesParser, type SaxesTagNS } from "saxes";
import { MAX_CREDENTIAL_CHARACTERS } from "../model/internal.js";
import { BAKED_KINDS, type BakedKind, CREDENTIAL_ELEMENT, FORMATS, VERIFY_ATTRIBUTE } from "./formats.js";

/**
 * The most characters that go to the parser at once, so that a reader which finds the credential at the top of a large image
 * does not hand it the rest.
 */
const CHUNK = 65_536;

/**
 * The most elements that may be open at once. The parser keeps an object for each open element, so 10 MiB of `<a>` would
 * otherwise cost hundreds of megabytes. The deepest DOM that a browser builds is 512; a badge image nests a few dozen groups.
 */
export const MAX_SVG_DEPTH = 256;

/**
 * The most attributes of one element, namespace declarations included. The parser keeps them until the tag ends, and 10 MiB
 * of attributes would otherwise cost hundreds of megabytes. An element of an SVG has a few dozen at most.
 */
export const MAX_SVG_ATTRIBUTES = 256;

/** The element that holds a credential, with where it lies in the text and what it holds. */
interface CredentialElement {
  readonly kind: BakedKind;
  /** The index of the `<` that opens it. */
  readonly start: number;
  /** The index after the `>` that closes it. */
  readonly end: number;
  /** The `verify` attribute, which holds a compact JWS. */
  readonly verify: string | undefined;
  /** Its text, with the text of its CDATA sections. */
  readonly text: string;
}

/** The root element of the document. */
interface RootElement {
  readonly name: string;
  readonly local: string;
  readonly uri: string;
  /** The index after the `>` that ends its start tag. */
  readonly end: number;
  readonly selfClosing: boolean;
  /** The namespaces in scope at the root, by prefix. */
  readonly bindings: Readonly<Record<string, string>>;
}

/** What a scan found. */
export interface SvgScan {
  readonly root: RootElement;
  /** The credential elements, outermost only, in document order. */
  readonly credentials: readonly CredentialElement[];
}

/** Tells which kind of credential an element is by its namespace and local name. */
function kindOfElement(tag: SaxesTagNS): BakedKind | undefined {
  return tag.local === CREDENTIAL_ELEMENT ? BAKED_KINDS.find((kind) => FORMATS[kind].namespace === tag.uri) : undefined;
}

/**
 * Scans an SVG with a parser that tracks namespaces, and finds its root and its credential elements. The limits on the depth
 * and the attributes are checked as the parser meets each tag, before it builds anything for it.
 *
 * @param svg - The text of the SVG.
 * @param all - Whether to read the whole document and every credential element, which a baker needs. When it is `false`, the
 * scan ends at the end of the first credential element, as the specifications say to extract it, and the rest is not read.
 * @throws `DataError` when the text is not well-formed XML before the point where the scan ends, nests or has attributes
 * beyond the limits, or a credential element holds another element.
 */
export function scanSvg(svg: string, all: boolean): SvgScan {
  const parser = new SaxesParser({ xmlns: true });
  const credentials: CredentialElement[] = [];
  // The parser reports a document without a root element as an error, which throws before this function returns.
  let root!: RootElement;
  let done = false;
  let depth = 0;
  let attributes = 0;
  let tagStart = 0;
  let open: { kind: BakedKind; start: number; depth: number; verify: string | undefined; text: string[] } | undefined;

  parser.on("error", (error) => {
    if (!done) throw new DataError(`The SVG is not well-formed XML at ${error.message}`);
  });
  parser.on("opentagstart", (tag) => {
    if (done) return;
    if (depth >= MAX_SVG_DEPTH) {
      throw new DataError(`The SVG nests more than ${MAX_SVG_DEPTH} elements, the most that it may here.`);
    }
    attributes = 0;
    // The parser has read the one character that ends the name (a space, `/` or `>`), and the name follows the `<`.
    tagStart = parser.position - tag.name.length - 2;
  });
  parser.on("attribute", () => {
    if (done) return;
    attributes += 1;
    if (attributes > MAX_SVG_ATTRIBUTES) {
      throw new DataError(
        `An element of the SVG has more than ${MAX_SVG_ATTRIBUTES} attributes, the most that it may here.`,
      );
    }
  });
  parser.on("opentag", (tag) => {
    if (done) return;
    if (open !== undefined) {
      throw new DataError("The credential element of the SVG holds an element. It may hold text only.");
    }
    depth += 1;
    if (depth === 1) {
      root = {
        name: tag.name,
        local: tag.local,
        uri: tag.uri,
        end: parser.position,
        selfClosing: tag.isSelfClosing,
        bindings: { ...tag.ns },
      };
    }
    const kind = kindOfElement(tag);
    if (kind !== undefined) {
      collected = 0;
      open = { kind, start: tagStart, depth, verify: tag.attributes[VERIFY_ATTRIBUTE]?.value, text: [] };
    }
  });
  let collected = 0;
  const collect = (text: string): void => {
    if (done || open === undefined) return;
    collected += text.length;
    // Checked as the text arrives, so that a credential element of 10 MiB is never joined into a string.
    if (collected > MAX_CREDENTIAL_CHARACTERS) {
      throw new DataError(
        `The credential element of the SVG has more than ${MAX_CREDENTIAL_CHARACTERS} characters, the most that an image may hold of it.`,
      );
    }
    open.text.push(text);
  };
  parser.on("text", collect);
  parser.on("cdata", collect);
  parser.on("closetag", () => {
    if (done) return;
    if (open?.depth === depth) {
      credentials.push({
        kind: open.kind,
        start: open.start,
        end: parser.position,
        verify: open.verify,
        text: open.text.join(""),
      });
      open = undefined;
      done = !all;
    }
    depth -= 1;
  });

  for (let at = 0; at < svg.length && !done; at += CHUNK) parser.write(svg.slice(at, at + CHUNK));
  if (!done) parser.close();
  return { root, credentials };
}
