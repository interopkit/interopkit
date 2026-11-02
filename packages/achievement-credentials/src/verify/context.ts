import { createStatusListCache, type StatusListCache } from "../status/index.js";
import type { SchemaLoad } from "./check-schema.js";
import type { VerifySettings } from "./options.js";

/** What one call of `verifyCredential` shares across the credentials that it verifies. */
export interface Context {
  readonly settings: VerifySettings;
  /** The status lists: the host's, or one that lasts for the call, so that a list that many credentials name is fetched once. */
  readonly statusLists: StatusListCache;
  /** The schemas that credentials name, by address, each fetched once for the call. */
  readonly schemas: Map<string, Promise<SchemaLoad>>;
}

/** Makes the context of a call. */
export function contextOf(settings: VerifySettings): Context {
  return {
    settings,
    statusLists: settings.statusLists ?? createStatusListCache({ clock: settings.jwt.clock }),
    schemas: new Map(),
  };
}
