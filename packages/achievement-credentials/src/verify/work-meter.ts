/** The error that ends a piece of work once it has read more than its budget. */
export class WorkLimitError extends Error {}

/** Counts the reads of the objects that it wraps, and ends the work that reads them once the count passes a budget. */
export interface WorkMeter {
  /** Returns a view of a value whose objects count each read of a member, the members that are objects wrapped in turn. */
  wrap<TValue>(value: TValue): TValue;
  /** Starts the count again, for the next piece of work. */
  reset(): void;
}

/**
 * Makes a meter of the reads of a value, which bounds work whose cost no static measure gives, such as a validator of JSON
 * Schema that runs a schema of anyone over a credential of anyone: every keyword that it applies, and every item that it
 * compares, is a read. A view is made once for each object, so the identity of an object is kept.
 *
 * @param budget - The most reads before the work ends with a `WorkLimitError`.
 */
export function createWorkMeter(budget: number): WorkMeter {
  let reads = 0;
  const views = new WeakMap<object, object>();
  const wrap = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null) return value;
    const known = views.get(value);
    if (known !== undefined) return known;
    const view = new Proxy(value, {
      get(target, key, receiver) {
        reads += 1;
        if (reads > budget) throw new WorkLimitError(`The work read more than ${budget} values.`);
        return wrap(Reflect.get(target, key, receiver));
      },
    });
    views.set(value, view);
    return view;
  };
  return {
    // The view has the type of the value: it answers every read as the value does.
    wrap: <TValue>(value: TValue) => wrap(value) as TValue,
    reset: () => {
      reads = 0;
    },
  };
}
