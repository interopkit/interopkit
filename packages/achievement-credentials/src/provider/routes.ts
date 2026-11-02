import { API_PATHS, type ScopedOperation } from "../model/internal.js";
import type { ProviderSettings } from "./options.js";

/** An operation of the API: one that an access token must hold a scope for, or the service description, which is public. */
type Operation = ScopedOperation | "getServiceDescription";

/** The endpoints of an API below its path, each with the operation of each method that it serves (OB 6.2, 6.3, CLR 5.2, 5.3). */
const ENDPOINTS: ReadonlyMap<string, ReadonlyMap<string, Operation>> = new Map([
  [
    "/credentials",
    new Map<string, Operation>([
      ["GET", "getCredentials"],
      ["POST", "upsertCredential"],
    ]),
  ],
  [
    "/profile",
    new Map<string, Operation>([
      ["GET", "getProfile"],
      ["PUT", "putProfile"],
    ]),
  ],
  ["/discovery", new Map<string, Operation>([["GET", "getServiceDescription"]])],
]);

/** What the path of a request names: the operations of an endpoint, by method. */
export type Route = ReadonlyMap<string, Operation>;

/**
 * Finds the endpoint that the path of a URL names, under the base path and the path of the API.
 *
 * @param pathname - The path of the request URL, as `URL` writes it.
 * @returns The operations of the endpoint by method, or `undefined` for a path that is no endpoint of the API.
 */
export function routeOf(pathname: string, { basePath, api }: ProviderSettings): Route | undefined {
  const root = `${basePath}${API_PATHS[api]}`;
  return pathname.startsWith(root) ? ENDPOINTS.get(pathname.slice(root.length)) : undefined;
}
