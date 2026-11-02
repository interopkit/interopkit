/** A grouping of members of one context (Context Groups 1.0 section 2.1). */
export interface Group {
  /** The identifier of the group, stable between requests. */
  readonly id: string;
  /** The human-readable name. */
  readonly name: string;
  /** A string that says what the group is for. */
  readonly tag?: string;
  /** The identifiers of the group sets the group belongs to. */
  readonly setIds?: readonly string[];
  /** Whether the group and its members are hidden from learners; `false` when absent. */
  readonly hidden?: boolean;
}

/** A gathering of groups of one context (Context Groups 1.0 section 2.2). */
export interface GroupSet {
  /** The identifier of the group set, stable between requests. */
  readonly id: string;
  /** The human-readable name. */
  readonly name: string;
  /** A string that says what the set is for, or a URL of the LIS context type vocabulary. */
  readonly tag?: string;
  /** Whether the set and its groups are hidden from learners; `false` when absent. */
  readonly hidden?: boolean;
}

/** The groups of a context, or of a user in it (`application/vnd.ims.lti-gs.v1.contextgroupcontainer+json`). */
export interface GroupContainer {
  /** The address of the container. */
  readonly id: string;
  /** The user the groups are for; present when the request asked for one user's groups. */
  readonly userId?: string;
  /** The groups. */
  readonly groups: readonly Group[];
}

/** The group sets of a context (`application/vnd.ims.lti-gs.v1.contextgroupsetcontainer+json`). */
export interface GroupSetContainer {
  /** The address of the container. */
  readonly id: string;
  /** The group sets. */
  readonly sets: readonly GroupSet[];
}

/** The filters of a request for groups (Context Groups 1.0 sections 2.1.2 and 2.5.3). */
export interface GroupQuery {
  /** Only the groups this user is enrolled in. */
  readonly userId?: string;
  /** The most groups or group sets to return; the platform may return fewer or more. */
  readonly limit?: number;
}
