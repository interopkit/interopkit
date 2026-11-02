// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims are those of the specifications.

import type { HttpResponse } from "@interopkit/core/http";
import { expect } from "vitest";
import { clientAssertion, TOOL_DEPLOYMENT_ID, tokenRequest } from "./fake-tool.js";
import { request } from "./fixture.js";
import { CLAIM, endpoints, handle, type Setup, toolKeys } from "./platform-setup.js";
import { textOf } from "./text-of.js";

/** Gets an access token for the first tool, with a deployment in its assertion unless `deployment` is `null`. */
export async function tokenFor(
  ctx: Setup,
  scope: string,
  deployment: string | null = TOOL_DEPLOYMENT_ID,
): Promise<string> {
  const claims = deployment === null ? {} : { [`${CLAIM}deployment_id`]: deployment };
  const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock, claims);
  const response = await handle(ctx, tokenRequest(endpoints.token, assertion, scope));
  expect(response.status, textOf(response.body)).toBe(200);
  return JSON.parse(textOf(response.body)).access_token;
}

/** A request to a service of the platform with a bearer token. */
export function call(
  url: string,
  token: string | undefined,
  init: { method?: string; type?: string; body?: unknown } = {},
): ReturnType<typeof request> {
  return request({
    url,
    method: init.method ?? "GET",
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(init.type === undefined ? {} : { "content-type": init.type }),
    },
    body: init.body === undefined ? "" : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

/** The JSON body of an answer. */
export const json = (response: HttpResponse) => JSON.parse(textOf(response.body));
