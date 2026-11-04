import { createStatusListCache } from "../status/index.js";
import type { SchemaLoad } from "./check-schema.js";
import type { VerifySettings } from "./options.js";

/** What one call of `verifyCredential` shares across the credentials that it verifies. */
export interface Context {
  /**
   * The settings of the call, whose status lists are the host's or a cache that lasts for the call, so that a list that many
   * credentials name is fetched once.
   */
  readonly settings: VerifySettings;
  /** The schemas that credentials name, by address, each fetched once for the call. */
  readonly schemas: Map<string, Promise<SchemaLoad>>;
  /** The refreshes that the call has made, which it bounds. */
  readonly refreshes: { count: number };
}

/** Makes the context of a call. */
export function contextOf(settings: VerifySettings): Context {
  return {
    settings: { ...settings, statusLists: settings.statusLists ?? createStatusListCache({ clock: settings.clock }) },
    schemas: new Map(),
    refreshes: { count: 0 },
  };
}
