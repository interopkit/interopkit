import { isRecord } from "@interopkit/core/checks";
import type { CaseIssue } from "../model/index.js";
import { identifierKey } from "../model/internal.js";

/** The rule of a link to its document or its package that an entity in the form of a package carries, which the form lacks. */
const RULE = "package-form-link";

/** The identifier of an entity or a link that the schemas have read. */
function identifierOf(entity: unknown): string | undefined {
  return isRecord(entity) && typeof entity.identifier === "string" ? entity.identifier : undefined;
}

/** Says that a link names another document than the one of the package. */
function* mismatch(link: unknown, path: string, document: string | undefined): Generator<CaseIssue> {
  const named = identifierOf(link);
  if (document === undefined || named === undefined || identifierKey(named) === identifierKey(document)) return;
  yield {
    path,
    rule: "reference-mismatch",
    severity: "warning",
    message: `the link names ${JSON.stringify(named)}, and the document of the package is ${JSON.stringify(document)}; the entity is read as a part of the package.`,
  };
}

/** Warns once for a list whose entities carry `CFDocumentURI`, and for each such link that names another document. */
function* listIssues(list: unknown, path: string, what: string, document: string | undefined): Generator<CaseIssue> {
  if (!Array.isArray(list)) return;
  const linked: [number, unknown][] = list.flatMap((entity, at) =>
    isRecord(entity) && entity.CFDocumentURI !== undefined ? [[at, entity.CFDocumentURI]] : [],
  );
  const [first] = linked;
  if (first === undefined) return;
  yield {
    path,
    rule: RULE,
    severity: "warning",
    message: `${linked.length} of the ${what} have a CFDocumentURI, the first at ${path}[${first[0]}], which the form of a package does not have; it is left out.`,
  };
  for (const [at, link] of linked) yield* mismatch(link, `${path}[${at}].CFDocumentURI`, document);
}

/**
 * Warns of the links that a value in the form of a package carries and that the form lacks: `CFPackageURI` in the document of a
 * package, and `CFDocumentURI` in its items and associations or in the associations of an item's set. Some providers write
 * them, South Carolina's in its packages and OpenSALT in the set of an item's associations; the readers leave them out.
 *
 * @param value - A value that the schemas have read, so that its shape is that of a package or an entity.
 * @returns One finding for each list whose entities carry the link, and one for each link that names another document than the
 * document of the package.
 */
export function* packageFormIssues(value: unknown): Generator<CaseIssue> {
  if (!isRecord(value)) return;
  const { CFDocument: document } = value;
  const documentIdentifier = identifierOf(document);
  if (isRecord(document) && document.CFPackageURI !== undefined) {
    yield {
      path: "CFDocument.CFPackageURI",
      rule: RULE,
      severity: "warning",
      message:
        "the document of a package heads the package and has no CFPackageURI in the form of a package; it is left out.",
    };
    yield* mismatch(document.CFPackageURI, "CFDocument.CFPackageURI", documentIdentifier);
  }
  yield* listIssues(value.CFItems, "CFItems", "items", documentIdentifier);
  yield* listIssues(value.CFAssociations, "CFAssociations", "associations", documentIdentifier);
}
