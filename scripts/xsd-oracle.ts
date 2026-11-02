import { XmlDocument, XsdValidator } from "libxml2-wasm";

/** What libxml2 says of a document: valid by the schema, or the first message of its refusal. */
type XsdVerdict = { readonly valid: true } | { readonly valid: false; readonly message: string };

/** A schema that libxml2 compiled, which judges documents until it is closed. */
export interface XsdOracle {
  /** Judges a document: well-formed, then valid by the schema. */
  verdict(xml: string): XsdVerdict;
  /** Frees the compiled schema. */
  close(): void;
}

/** The first line of the message of a refusal of libxml2. */
function firstLine(error: unknown): string {
  const details = (error as { details?: readonly { message?: string }[] }).details;
  const message = details?.[0]?.message ?? (error instanceof Error ? error.message : String(error));
  return message.trim().split("\n")[0] ?? "";
}

/**
 * Compiles a schema with libxml2, the validator of `xmllint` and of the player of CATAPULT, as the oracle of a reader that
 * enforces the schema itself.
 *
 * @param xsd - The text of the schema.
 * @throws `Error` when the schema does not compile.
 */
export function createXsdOracle(xsd: string): XsdOracle {
  const schema = XmlDocument.fromString(xsd);
  const validator = XsdValidator.fromDoc(schema);
  return {
    verdict(xml) {
      let document: XmlDocument;
      try {
        document = XmlDocument.fromString(xml);
      } catch (error) {
        return { valid: false, message: `not well-formed: ${firstLine(error)}` };
      }
      try {
        validator.validate(document);
        return { valid: true };
      } catch (error) {
        return { valid: false, message: firstLine(error) };
      } finally {
        document.dispose();
      }
    },
    close() {
      validator.dispose();
      schema.dispose();
    },
  };
}
