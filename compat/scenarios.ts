import { callService, type Fetch, ServiceError } from "@interopkit/core";
import { runScenario as runAnalytics } from "../examples/learning-analytics/scenario.ts";
import { runScenario as runTool } from "../examples/tool-integration/scenario.ts";

/** What every runtime must give: plain data, the same on each. */
export interface Results {
  /** The sends of the sensor example: the status, and the events of each. */
  readonly analytics: readonly { readonly status: number; readonly events: readonly string[] }[];
  /** The platform and the tool of the tool-integration example, as the example reports them. */
  readonly tool: Awaited<ReturnType<typeof runTool>>;
  /** What `callService` does with the global `fetch` of the runtime, against the server of the check. */
  readonly service: Readonly<Record<string, unknown>>;
}

const GET = { method: "GET", headers: {} } as const;
/** The deadline of a call that the server answers: long, so that a runtime that starts slowly or a busy host does not end it. */
const ANSWER_DEADLINE_MS = 10_000;
/** The deadline of a call that the server never answers: short, so that the check ends soon. */
const HANG_DEADLINE_MS = 300;

/** Returns the status and the body that a call to a service failed with, or what the failure was if it was not one. */
async function failureOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
    return "no failure";
  } catch (error) {
    return error instanceof ServiceError
      ? { status: error.status, body: error.body.slice(0, 16), bytes: error.body.length }
      : String(error);
  }
}

/**
 * Calls the server of the check with the global `fetch` of the runtime, which `callService` calls as a bare function, with
 * `redirect` set to `"manual"`, a deadline and a size limit.
 */
async function serviceChecks(base: string): Promise<Record<string, unknown>> {
  // The global fetch, unbound: a runtime that needs a receiver would throw here.
  const service = { fetch: fetch as Fetch, timeoutMs: ANSWER_DEADLINE_MS };
  const ok = await callService(service, "The server", `${base}/ok`, GET);
  const redirect = await failureOf(callService(service, "The server", `${base}/redirect`, GET));
  const error = await failureOf(callService(service, "The server", `${base}/error`, GET));
  const large = await failureOf(callService(service, "The server", `${base}/large`, GET));
  const hang = await failureOf(
    callService({ ...service, timeoutMs: HANG_DEADLINE_MS }, "The server", `${base}/hang`, GET),
  );
  let aborted = "no failure";
  try {
    await callService({ ...service, signal: AbortSignal.timeout(100) }, "The server", `${base}/hang`, GET);
  } catch (reason) {
    aborted = reason instanceof Error ? reason.name : String(reason);
  }
  return { ok, redirect, error, large, hang, aborted };
}

/**
 * Runs the scenarios of the two examples and the checks of the service call.
 *
 * @param base - The address of the server of the check.
 */
export async function runAll(base: string): Promise<Results> {
  const sends = await runAnalytics();
  return {
    analytics: sends.map(({ status, body }) => ({
      status,
      events: (JSON.parse(body).data as readonly { readonly id: string }[]).map((event) => event.id),
    })),
    tool: await runTool(),
    service: await serviceChecks(base),
  };
}
