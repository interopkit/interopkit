import { callPort, DataError } from "@interopkit/core";
import { isDateTime, parseWith } from "@interopkit/core/checks";
import {
  buildJsonResponse,
  buildPageLinks,
  type HttpRequest,
  type HttpResponse,
  type OffsetPage,
  readOffsetPage,
  readQuery,
} from "@interopkit/core/http";
import * as v from "valibot";
import type { ProviderSettings } from "./options.js";
import { receiveCredential } from "./receive.js";
import { internalError, invalidQuery } from "./status.js";
import { type CredentialsPage, listSchema, UPSERT_OUTCOMES } from "./store.js";

/** The status of the answer to each outcome of an upsert (OB 6.2.3.2). */
const UPSERT_STATUSES = { created: 201, replaced: 200, unchanged: 304 } as const;

/** Reads the page of the list that a query asks for: `limit`, `offset` and `since` (OB 6.2.2.1), or the sentence that refuses it. */
function pageOf(request: HttpRequest, settings: ProviderSettings): CredentialsPage | string {
  let parameters: ReadonlyMap<string, string>;
  let page: OffsetPage;
  try {
    parameters = readQuery(request);
    page = readOffsetPage(parameters, settings);
  } catch (error) {
    // Both throw a `DataError` that names the parameter: one given twice, or a limit or an offset that is no whole number.
    return error instanceof Error ? error.message : "The query of the request cannot be read.";
  }
  const since = parameters.get("since");
  if (since === undefined) return page;
  // The OpenAPI file gives `since` the format date-time, which has an offset, so that the time names one instant.
  if (!isDateTime(since)) {
    return `The parameter since must be a date and time of RFC 3339 with an offset, such as 2024-06-13T18:46:03Z, found ${JSON.stringify(since)}.`;
  }
  return { ...page, since };
}

/**
 * Answers getCredentials (OB 6.2.2, CLR 5.2.2): a page of the owner's credentials, the objects in `credential` and the compact
 * JWS in `compactJwsString`, with `X-Total-Count` when the store counts them and `Link` (OB 6.4).
 */
export async function answerList(
  request: HttpRequest,
  owner: string,
  settings: ProviderSettings,
): Promise<HttpResponse> {
  const page = pageOf(request, settings);
  if (typeof page === "string") return invalidQuery(page);
  const { signal } = settings;
  const asked = await callPort(() => settings.credentials.list(owner, page, { signal }), signal);
  if (asked === undefined) return internalError();
  const answer = parseWith(listSchema, asked.value, "The answer of CredentialStore.list");
  const { credentials, total } = answer;
  if (credentials.length > page.limit) {
    throw new DataError(
      `The answer of CredentialStore.list has ${credentials.length} credentials for a limit of ${page.limit}: it must return at most the limit.`,
    );
  }
  const objects = credentials.filter((each) => typeof each !== "string");
  const signed = credentials.filter((each) => typeof each === "string");
  const extent = total === undefined ? { more: credentials.length === page.limit } : { total };
  return buildJsonResponse(
    200,
    { credential: objects, compactJwsString: signed },
    {
      ...(total === undefined ? {} : { "x-total-count": String(total) }),
      link: buildPageLinks(request.url, page, extent),
    },
  );
}

/**
 * Answers upsertCredential (OB 6.2.3, CLR 5.2.3): reads and checks the credential, asks the store to create or replace it, and
 * answers 201 or 200 with the credential of the request, or 304 with no body when the store kept the one it held.
 */
export async function answerUpsert(
  request: HttpRequest,
  owner: string,
  settings: ProviderSettings,
): Promise<HttpResponse> {
  const reception = await receiveCredential(request, settings);
  if ("refusal" in reception) return reception.refusal;
  const { signal } = settings;
  const asked = await callPort(() => settings.credentials.upsert(owner, reception.credential, { signal }), signal);
  if (asked === undefined) return internalError();
  const outcome = parseWith(v.picklist(UPSERT_OUTCOMES), asked.value, "The answer of CredentialStore.upsert");
  const status = UPSERT_STATUSES[outcome];
  // A 304 has no content (RFC 9110, 15.4.5), whatever the OpenAPI file lists for it.
  if (status === UPSERT_STATUSES.unchanged) return { status, headers: {}, body: "" };
  return { status, headers: { "content-type": reception.echo.type }, body: reception.echo.text };
}
