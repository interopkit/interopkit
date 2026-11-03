import { callPort, DataError } from "@interopkit/core";
import { FAILED } from "../status.js";
import { type Context, refused, type Verdict } from "../verdict.js";

/** Finds the time up to which the store holds every Statement, for the header the standard asks for. */
export async function consistentThrough(context: Context): Promise<Verdict<string>> {
  const { signal } = context.settings;
  const asked = await callPort(() => context.settings.statements.consistentThrough({ signal }), { signal });
  if (asked === undefined) return refused(500, FAILED);
  if (typeof asked.value !== "string" || asked.value === "") {
    throw new DataError("The answer of StatementStore.consistentThrough must be a time as text.");
  }
  return { value: asked.value };
}
