import type {
  CasePackage,
  CFAssociation,
  CFConceptSet,
  CFDocument,
  CFItem,
  CFItemTypeSet,
  CFPckgAssociation,
  CFPckgItem,
  CFSubjectSet,
  LinkURI,
} from "@interopkit/competency-frameworks";
import { type FrameworkStore, queryEntities } from "@interopkit/competency-frameworks/provider";
import { partUriOf } from "./identifiers.ts";

/** The frameworks a provider publishes, and the store that serves them. */
export interface Catalog {
  /** The store for `handleCaseRequest`. */
  readonly store: FrameworkStore;
  /** Publishes a framework, or replaces the framework with the same document identifier. */
  publish(framework: CasePackage): void;
}

/** What the store knows of an entity: the entity itself and the framework it belongs to. */
interface Held<T> {
  readonly value: T;
  readonly framework: CasePackage;
}

/** An entity of a hierarchy: a concept, a subject or an item type. */
interface Hierarchical {
  readonly identifier: string;
  readonly hierarchyCode: string;
}

const key = (identifier: string): string => identifier.toLowerCase();

/** Returns the link to the document of a framework, which an item or an association carries outside its package. */
function documentLink(framework: CasePackage): LinkURI {
  const { identifier, title, uri } = framework.CFDocument;
  return { title, identifier, uri };
}

/** Returns an entity with the hierarchy code of its children: one level below its own. */
function withChildren<T extends Hierarchical>(entity: T, all: readonly T[]): readonly T[] {
  const prefix = `${entity.hierarchyCode}.`;
  const children = all.filter(
    ({ hierarchyCode }) => hierarchyCode.startsWith(prefix) && !hierarchyCode.slice(prefix.length).includes("."),
  );
  return [entity, ...children];
}

/**
 * Creates a catalog of frameworks in memory. A host with a database answers the same twelve questions from its tables: the
 * documents of a page, and an entity by identifier, in the form that the binding serves it.
 *
 * @param origin - The address of the provider before the path of the version, which the addresses of packages carry.
 */
export function createCatalog(origin: string): Catalog {
  const frameworks = new Map<string, CasePackage>();
  const find = <T>(pick: (framework: CasePackage) => readonly T[], identify: (value: T) => string) => {
    return (identifier: string): Held<T> | undefined => {
      for (const framework of frameworks.values()) {
        const value = pick(framework).find((each) => key(identify(each)) === key(identifier));
        if (value !== undefined) return { value, framework };
      }
      return undefined;
    };
  };
  const byIdentifier = ({ identifier }: { readonly identifier: string }): string => identifier;
  const items = find((framework) => framework.CFItems ?? [], byIdentifier);
  const associations = find((framework) => framework.CFAssociations ?? [], byIdentifier);
  const groupings = find((framework) => framework.CFDefinitions?.CFAssociationGroupings ?? [], byIdentifier);
  const concepts = find((framework) => framework.CFDefinitions?.CFConcepts ?? [], byIdentifier);
  const subjects = find((framework) => framework.CFDefinitions?.CFSubjects ?? [], byIdentifier);
  const licenses = find((framework) => framework.CFDefinitions?.CFLicenses ?? [], byIdentifier);
  const itemTypes = find((framework) => framework.CFDefinitions?.CFItemTypes ?? [], byIdentifier);
  const rubrics = find((framework) => framework.CFRubrics ?? [], byIdentifier);

  const documentOf = (framework: CasePackage): CFDocument => ({
    ...framework.CFDocument,
    CFPackageURI: {
      title: framework.CFDocument.title,
      identifier: framework.CFDocument.identifier,
      uri: partUriOf(origin, "CFPackages", framework.CFDocument.identifier),
    },
  });
  const itemOf = ({ value, framework }: Held<CFPckgItem>): CFItem => ({
    ...value,
    CFDocumentURI: documentLink(framework),
  });
  const associationOf = ({ value, framework }: Held<CFPckgAssociation>): CFAssociation => ({
    ...value,
    CFDocumentURI: documentLink(framework),
  });
  const touches = (association: CFPckgAssociation, identifier: string): boolean =>
    key(association.originNodeURI.identifier) === key(identifier) ||
    key(association.destinationNodeURI.identifier) === key(identifier);

  const store: FrameworkStore = {
    async documents(query, page) {
      const matching = queryEntities([...frameworks.values()].map(documentOf), query);
      return { documents: matching.slice(page.offset, page.offset + page.limit), total: matching.length };
    },
    async document(identifier) {
      const framework = frameworks.get(key(identifier));
      return framework === undefined ? undefined : documentOf(framework);
    },
    async package(identifier) {
      return frameworks.get(key(identifier));
    },
    async item(identifier) {
      const held = items(identifier);
      return held === undefined ? undefined : itemOf(held);
    },
    async itemAssociations(identifier) {
      const held = items(identifier);
      if (held === undefined) return undefined;
      return {
        CFItem: itemOf(held),
        // Inside a set the associations have the form they have in a package: the set names the item, not their document.
        CFAssociations: (held.framework.CFAssociations ?? []).filter((association) => touches(association, identifier)),
      };
    },
    async association(identifier) {
      const held = associations(identifier);
      return held === undefined ? undefined : associationOf(held);
    },
    async associationGrouping(identifier) {
      return groupings(identifier)?.value;
    },
    async concept(identifier): Promise<CFConceptSet | undefined> {
      const held = concepts(identifier);
      if (held === undefined) return undefined;
      return { CFConcepts: withChildren(held.value, held.framework.CFDefinitions?.CFConcepts ?? []) };
    },
    async subject(identifier): Promise<CFSubjectSet | undefined> {
      const held = subjects(identifier);
      if (held === undefined) return undefined;
      return { CFSubjects: withChildren(held.value, held.framework.CFDefinitions?.CFSubjects ?? []) };
    },
    async license(identifier) {
      return licenses(identifier)?.value;
    },
    async itemType(identifier): Promise<CFItemTypeSet | undefined> {
      const held = itemTypes(identifier);
      if (held === undefined) return undefined;
      return { CFItemTypes: withChildren(held.value, held.framework.CFDefinitions?.CFItemTypes ?? []) };
    },
    async rubric(identifier) {
      return rubrics(identifier)?.value;
    },
  };
  return {
    store,
    publish(framework) {
      frameworks.set(key(framework.CFDocument.identifier), framework);
    },
  };
}
