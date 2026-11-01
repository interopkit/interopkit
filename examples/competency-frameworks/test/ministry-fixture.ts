import { createCaseClient } from "@interopkit/competency-frameworks/client";
import { DISCOVERY } from "../scenario.ts";
import { createCatalog } from "../src/catalog.ts";
import { MINISTRY_ORIGIN, mathematics2024, reading2024 } from "../src/ministry.ts";
import { createProvider, type ProviderConfig } from "../src/provider.ts";

/** A provider of the ministry's two frameworks, and a client of it, for a test; `changes` replace the provider's settings. */
export function ministry(changes: Partial<ProviderConfig> = {}) {
  const catalog = createCatalog(MINISTRY_ORIGIN);
  catalog.publish(mathematics2024());
  catalog.publish(reading2024());
  const provider = createProvider({ catalog, origin: MINISTRY_ORIGIN, discovery: DISCOVERY, ...changes });
  const client = createCaseClient({ baseUrl: MINISTRY_ORIGIN, fetch: provider.fetch });
  return { catalog, provider, client };
}
