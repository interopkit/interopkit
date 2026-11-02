import type {
  GradebookStore,
  ReceivedScore,
  ServiceCaller,
  StoredLineItem,
  StoredResult,
} from "@interopkit/tool-integration/platform";

/** The gradebook of one course: its line items, and the latest score of each user for each line item. */
interface Course {
  /** The tool whose line items these are; another tool sees no course here. */
  readonly clientId: string;
  readonly lineItems: Map<string, StoredLineItem>;
  readonly scores: Map<string, Map<string, ReceivedScore>>;
}

/** A gradebook in memory, and the scores it kept, in order. */
export interface Gradebook {
  readonly store: GradebookStore;
  /** Adds a line item to a course of a tool, as the platform's own gradebook does when it creates the link. */
  add(clientId: string, contextId: string, lineItem: StoredLineItem): void;
  /** The scores that the store kept, as `{ lineItemId, score }`, in order. */
  readonly kept: readonly { readonly lineItemId: string; readonly score: ReceivedScore }[];
}

/**
 * Creates a gradebook in memory. A real host keeps it in its database, where `keepScore` compares the timestamps and writes in
 * one transaction.
 */
export function createGradebook(): Gradebook {
  const courses = new Map<string, Course>();
  const kept: { lineItemId: string; score: ReceivedScore }[] = [];
  let next = 0;
  // A course is the caller's only when it is the tool's: anything else is `undefined`, which the platform answers with 404.
  const courseOf = (caller: ServiceCaller, contextId: string): Course | undefined => {
    const course = courses.get(contextId);
    return course?.clientId === caller.clientId ? course : undefined;
  };
  const store: GradebookStore = {
    async lineItems(caller, contextId, query) {
      const course = courseOf(caller, contextId);
      if (course === undefined) return undefined;
      const all = [...course.lineItems.values()].filter(
        (item) =>
          (query.resourceId === undefined || item.resourceId === query.resourceId) &&
          (query.resourceLinkId === undefined || item.resourceLinkId === query.resourceLinkId) &&
          (query.tag === undefined || item.tag === query.tag),
      );
      const start = Number(query.cursor ?? 0);
      const end = start + query.limit;
      return { items: all.slice(start, end), ...(end < all.length ? { cursor: String(end) } : {}) };
    },
    async lineItem(caller, contextId, lineItemId) {
      return courseOf(caller, contextId)?.lineItems.get(lineItemId);
    },
    async createLineItem(caller, contextId, input) {
      const course = courseOf(caller, contextId);
      if (course === undefined) return undefined;
      next += 1;
      const created = { ...input, id: `created-${next}` };
      course.lineItems.set(created.id, created);
      return created;
    },
    async updateLineItem(caller, contextId, lineItemId, input) {
      const course = courseOf(caller, contextId);
      if (course?.lineItems.has(lineItemId) !== true) return undefined;
      const updated = { ...input, id: lineItemId };
      course.lineItems.set(lineItemId, updated);
      return updated;
    },
    async deleteLineItem(caller, contextId, lineItemId) {
      return courseOf(caller, contextId)?.lineItems.delete(lineItemId) ?? false;
    },
    async results(caller, contextId, lineItemId, query) {
      const course = courseOf(caller, contextId);
      if (course?.lineItems.has(lineItemId) !== true) return undefined;
      const results: StoredResult[] = [...(course.scores.get(lineItemId)?.values() ?? [])]
        .filter((score) => query.userId === undefined || score.userId === query.userId)
        .map((score) => ({
          userId: score.userId,
          ...(score.scoreGiven === undefined
            ? {}
            : { resultScore: score.scoreGiven, resultMaximum: score.scoreMaximum }),
          ...(score.comment === undefined ? {} : { comment: score.comment }),
        }));
      return { items: results.slice(0, query.limit) };
    },
    async keepScore(caller, contextId, lineItemId, score) {
      const course = courseOf(caller, contextId);
      if (course?.lineItems.has(lineItemId) !== true) return undefined;
      const scores = course.scores.get(lineItemId) ?? new Map<string, ReceivedScore>();
      // AGS 3.4.9: a score never replaces a later one; an equal time replaces, so that a retry completes.
      const earlier = scores.get(score.userId);
      if (earlier !== undefined && earlier.timestampMs > score.timestampMs) return "older";
      scores.set(score.userId, score);
      course.scores.set(lineItemId, scores);
      kept.push({ lineItemId, score });
      return "kept";
    },
  };
  return {
    store,
    add(clientId, contextId, lineItem) {
      const course = courses.get(contextId) ?? { clientId, lineItems: new Map(), scores: new Map() };
      course.lineItems.set(lineItem.id, lineItem);
      courses.set(contextId, course);
    },
    kept,
  };
}
