/**
 * What a consumer asks of a framework once it holds it: the tree of its items, the associations of a node, the crosswalk
 * between two frameworks, the difference between two versions, whether a copy is stale, the adoption status of a framework,
 * and the address at which an entity belongs.
 *
 * @module @interopkit/competency-frameworks/graph
 */
export { ADOPTION_STATUSES, type AdoptionStatus, adoptionStatus } from "./adoption-status.js";
export { associationsOf, type NodeAssociations } from "./associations.js";
export { type CrosswalkLink, type CrosswalkOptions, crosswalk } from "./crosswalk.js";
export { type ChangedItem, diffPackages, type PackageDiff, type ReplacedItem } from "./diff.js";
export { type CaseEntityUriOptions, caseEntityUri } from "./entity-uri.js";
export { isNewer } from "./staleness.js";
export { type FrameworkNode, frameworkTree } from "./tree.js";
