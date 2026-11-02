import { DataError } from "@interopkit/core";
import { SaxesParser } from "saxes";
import { COURSE_STRUCTURE_NAMESPACE, type ExtensionElement } from "../model/index.js";

/**
 * Checks that an extension is one well-formed element of its namespace and name, and nothing else, so that a writer can put
 * it into a course structure as written without changing what the structure says.
 *
 * @remarks
 * An element of the extension without a prefix is in the namespace that the extension declares as its default. One that
 * would be in no namespace on its own would take the namespace of cmi5 inside the structure, so the extension must declare
 * `xmlns=""` for it.
 *
 * @param extension - The extension, read already into its three strings.
 * @param path - The path of the extension in the structure, for the message.
 * @throws `DataError` that names the path and the fault.
 */
export function checkExtensionElement(extension: ExtensionElement, path: string): void {
  const { namespace, name, xml } = extension;
  const fail = (fault: string): never => {
    throw new DataError(`The extension at ${path} ${fault}`);
  };
  if (namespace === "" || namespace === COURSE_STRUCTURE_NAMESPACE) {
    fail(`has the namespace ${JSON.stringify(namespace)}, and an extension is in a namespace other than that of cmi5.`);
  }
  if (!xml.startsWith("<") || xml.startsWith("<?") || xml.startsWith("<!")) {
    fail("does not start with its element: its xml is one element, with nothing before or after it.");
  }
  const parser = new SaxesParser({ xmlns: true });
  // Whether each open element is inside a declaration of the default namespace that the extension makes itself.
  const defaults: boolean[] = [];
  let end = -1;
  parser.on("error", (error) => fail(`is not well-formed XML: ${error.message}`));
  parser.on("opentag", (tag) => {
    if (defaults.length === 0 && (tag.uri !== namespace || tag.local !== name)) {
      fail(
        `is the element <${tag.local}> of ${JSON.stringify(tag.uri)}, not <${name}> of ${JSON.stringify(namespace)}.`,
      );
    }
    const declared = Object.hasOwn(tag.ns, "") || defaults.at(-1) === true;
    if (tag.prefix === "" && tag.uri === "" && !declared) {
      fail(
        `holds the element <${tag.local}> of no namespace, which would be an element of cmi5 in the structure: declare xmlns="" on it.`,
      );
    }
    defaults.push(declared);
  });
  parser.on("closetag", () => {
    defaults.pop();
    if (defaults.length === 0) end = parser.position;
  });
  parser.write(xml).close();
  if (end !== xml.length)
    fail("holds something after its element: its xml is one element, with nothing before or after it.");
}
