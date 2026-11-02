import type { Fetch } from "@interopkit/core";
import { createLrsClient, type LrsClient } from "@interopkit/learning-records/client";
import { ORIGIN } from "./campus.ts";

/** The clients of the campus LRS: the platform writes everything, and the dashboard reads. */
export const PLATFORM = { user: "platform", password: "platform-secret" } as const;
export const DASHBOARD = { user: "dashboard", password: "dashboard-secret" } as const;

/** Makes the client that signs in as a user, over a `fetch`. */
export function clientFor(
  fetch: Fetch,
  { user, password }: { readonly user: string; readonly password: string },
): LrsClient {
  return createLrsClient({
    endpoint: `${ORIGIN}/xapi/`,
    fetch,
    authorization: async () => `Basic ${btoa(`${user}:${password}`)}`,
  });
}
