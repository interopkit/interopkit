import { createLrsClient, type LrsClient, type LrsClientOptions } from "../src/client/index.js";
import type { Statement } from "../src/index.js";
import type { FakeLrs } from "./fake-lrs.js";
import { uuid } from "./full-statement.js";

export const ENDPOINT = "https://lrs.example.org/xapi/";

/** The `X-Experience-API-Consistent-Through` that a fake LRS answers a page with. */
export const CONSISTENT_THROUGH = "2026-01-15T10:30:00.000Z";

/** A client of a fake LRS, with the configuration of a test. */
export function clientOf(lrs: FakeLrs, config: Partial<LrsClientOptions> = {}): LrsClient {
  return createLrsClient({ endpoint: ENDPOINT, fetch: lrs.fetch, ...config });
}

/** What a rejected promise rejected with. */
export async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("The promise resolved.");
}

/** Everything that an iteration gives. */
export async function collect<TItem>(items: AsyncIterable<TItem>): Promise<TItem[]> {
  const found: TItem[] = [];
  for await (const item of items) found.push(item);
  return found;
}

/** Input as a host passes it from JavaScript or JSON. */
export const fromJson = <TValue>(text: string): TValue => JSON.parse(text);

/** A Statement that a provider may send, with the id of its number. */
export function statementOf(n: number): Statement {
  return {
    id: uuid(n),
    actor: { mbox: "mailto:learner@example.org" },
    verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
    object: { objectType: "Activity", id: `https://example.org/activities/course-${n}` },
    timestamp: "2026-01-15T10:30:00.000Z",
  };
}
