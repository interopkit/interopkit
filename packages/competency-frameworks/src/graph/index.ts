/**
 * What a consumer asks of a framework once it holds it: the tree of its items, the associations of a node, the crosswalk
 * between two frameworks, the difference between two versions, whether a copy is stale, the adoption status of a framework,
 * and the address at which an entity belongs.
 *
 * @module @interopkit/competency-frameworks/graph
 */
export { ADOPTION_STATUSES, type AdoptionStatus, readAdoptionStatus } from "./adoption-status.js";
export { listAssociations, type NodeAssociations } from "./associations.js";
export { type CrosswalkLink, type CrosswalkOptions, crosswalk } from "./crosswalk.js";
export { type ChangedItem, diffPackages, type PackageDiff, type ReplacedItem } from "./diff.js";
export { buildEntityUri, type CaseEntityUriOptions } from "./entity-uri.js";
export { isNewer } from "./staleness.js";
export { buildFrameworkTree, type FrameworkNode } from "./tree.js";
