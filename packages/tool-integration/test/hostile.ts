import { inject } from "vitest";

/** The origin of the hostile server of the browser tests, whose pages send messages and record the ones they receive. */
export const hostileOrigin = inject("fixtures").hostile;

/** The paths that a fixture server was asked for. */
export async function requestsTo(server: string): Promise<string[]> {
  return (await fetch(`${server}/__hits`, { cache: "no-store" })).json();
}

/** The messages that the probe of the hostile origin with an id received, as the origin and the data of each, in order. */
export async function seenBy(id: string): Promise<{ origin: string; data: Record<string, unknown> }[]> {
  return (await requestsTo(hostileOrigin))
    .filter((path) => path.startsWith(`/seen?id=${id}&`))
    .map((path) => JSON.parse(decodeURIComponent(path.slice(path.indexOf("&m=") + 3))));
}
