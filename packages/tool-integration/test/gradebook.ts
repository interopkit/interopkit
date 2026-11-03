import type { CallOptions } from "@interopkit/core";
import type {
  GradebookStore,
  ReceivedScore,
  ServiceCaller,
  StoredLineItem,
  StoredResult,
  StorePage,
} from "../src/platform/index.js";

/** One call to the gradebook: the method, the caller and the other arguments, without the options. */
export interface StoreCall {
  readonly method: keyof GradebookStore;
  readonly caller: ServiceCaller;
  readonly args: readonly unknown[];
  readonly signal: AbortSignal | undefined;
}

/**
 * A gradebook in memory for the tests of the grade services: the courses of one tool, their line items in order, and the
 * latest score of each user, kept unless a later one is (AGS 3.4.9). It records every call, so that a test sees what the
 * platform passed.
 */
export class MemoryGradebook implements GradebookStore {
  /** The client whose courses these are; another caller sees none. */
  owner: string;
  readonly courses = new Map<string, Map<string, StoredLineItem>>();
  readonly scores = new Map<string, Map<string, ReceivedScore>>();
  readonly calls: StoreCall[] = [];
  private created = 0;

  constructor(owner: string) {
    this.owner = owner;
  }

  /** Adds a line item to a course. */
  add(contextId: string, item: StoredLineItem): this {
    const course = this.courses.get(contextId) ?? new Map<string, StoredLineItem>();
    course.set(item.id, item);
    this.courses.set(contextId, course);
    return this;
  }

  private record(
    method: keyof GradebookStore,
    caller: ServiceCaller,
    options: CallOptions | undefined,
    args: unknown[],
  ) {
    this.calls.push({ method, caller, args, signal: options?.signal });
  }

  private course(caller: ServiceCaller, contextId: string): Map<string, StoredLineItem> | undefined {
    return caller.clientId === this.owner ? this.courses.get(contextId) : undefined;
  }

  async lineItems(
    caller: ServiceCaller,
    contextId: string,
    query: Parameters<NonNullable<GradebookStore["lineItems"]>>[2],
    options?: CallOptions,
  ): Promise<StorePage<StoredLineItem> | undefined> {
    this.record("lineItems", caller, options, [contextId, query]);
    const course = this.course(caller, contextId);
    if (course === undefined) return undefined;
    const all = [...course.values()].filter(
      (item) =>
        (query.resourceId === undefined || item.resourceId === query.resourceId) &&
        (query.resourceLinkId === undefined || item.resourceLinkId === query.resourceLinkId) &&
        (query.tag === undefined || item.tag === query.tag),
    );
    const start = Number(query.cursor ?? "0");
    const end = start + query.limit;
    return { items: all.slice(start, end), ...(end < all.length ? { cursor: String(end) } : {}) };
  }

  async lineItem(caller: ServiceCaller, contextId: string, lineItemId: string, options?: CallOptions) {
    this.record("lineItem", caller, options, [contextId, lineItemId]);
    return this.course(caller, contextId)?.get(lineItemId);
  }

  async createLineItem(
    caller: ServiceCaller,
    contextId: string,
    input: Parameters<NonNullable<GradebookStore["createLineItem"]>>[2],
    options?: CallOptions,
  ) {
    this.record("createLineItem", caller, options, [contextId, input]);
    const course = this.course(caller, contextId);
    if (course === undefined || input.activityId === "no-such-activity") return undefined;
    this.created += 1;
    const item = { ...input, id: `new-${this.created}` };
    course.set(item.id, item);
    return item;
  }

  async updateLineItem(
    caller: ServiceCaller,
    contextId: string,
    lineItemId: string,
    input: Parameters<NonNullable<GradebookStore["updateLineItem"]>>[3],
    options?: CallOptions,
  ) {
    this.record("updateLineItem", caller, options, [contextId, lineItemId, input]);
    const course = this.course(caller, contextId);
    if (course?.has(lineItemId) !== true) return undefined;
    const item = { ...input, id: lineItemId };
    course.set(lineItemId, item);
    return item;
  }

  async deleteLineItem(caller: ServiceCaller, contextId: string, lineItemId: string, options?: CallOptions) {
    this.record("deleteLineItem", caller, options, [contextId, lineItemId]);
    return this.course(caller, contextId)?.delete(lineItemId) ?? false;
  }

  async results(
    caller: ServiceCaller,
    contextId: string,
    lineItemId: string,
    query: Parameters<NonNullable<GradebookStore["results"]>>[3],
    options?: CallOptions,
  ): Promise<StorePage<StoredResult> | undefined> {
    this.record("results", caller, options, [contextId, lineItemId, query]);
    if (this.course(caller, contextId)?.has(lineItemId) !== true) return undefined;
    const results = [...(this.scores.get(`${contextId}/${lineItemId}`)?.values() ?? [])]
      .filter((score) => query.userId === undefined || score.userId === query.userId)
      .map((score) => ({
        userId: score.userId,
        ...(score.scoreGiven === undefined ? {} : { resultScore: score.scoreGiven, resultMaximum: score.scoreMaximum }),
        ...(score.comment === undefined ? {} : { comment: score.comment }),
      }));
    return { items: results.slice(0, query.limit) };
  }

  async keepScore(
    caller: ServiceCaller,
    contextId: string,
    lineItemId: string,
    score: ReceivedScore,
    options?: CallOptions,
  ): Promise<"kept" | "older" | undefined> {
    this.record("keepScore", caller, options, [contextId, lineItemId, score]);
    if (this.course(caller, contextId)?.has(lineItemId) !== true) return undefined;
    const key = `${contextId}/${lineItemId}`;
    const scores = this.scores.get(key) ?? new Map<string, ReceivedScore>();
    const earlier = scores.get(score.userId);
    if (earlier !== undefined && earlier.timestampMs > score.timestampMs) return "older";
    scores.set(score.userId, score);
    this.scores.set(key, scores);
    return "kept";
  }
}
