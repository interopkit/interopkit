import { runAll } from "./scenarios.ts";

/** The worker answers a request with the results as JSON; the address of the server of the check is in the query. */
// biome-ignore lint/style/noDefaultExport: a Worker module exports its handlers as the default export.
export default {
  async fetch(request: Request): Promise<Response> {
    return Response.json(await runAll(new URL(request.url).searchParams.get("server") ?? ""));
  },
};
