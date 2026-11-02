import {
  type CredentialStore,
  type CredentialsProviderOptions,
  handleCredentialsRequest,
} from "@interopkit/achievement-credentials/provider";
import { handleRefreshRequest } from "@interopkit/achievement-credentials/refresh";
import type { HttpRequest } from "@interopkit/core/http";
import { expect, test } from "vitest";
import { clrOf, credentialOf } from "./bench-fixtures.js";
import { alternate, expectRatioWithin } from "./budgets.js";
import { description, ORIGIN, ROOTS } from "./provider-fixture.js";

/** The credentials of a page of the list: the most that a page holds by default. */
const PAGE = 100;
const OWNER = "learner-1";
const encoder = new TextEncoder();

/** The credentials that the store of a learner holds as JSON, as a database gives them back. */
const HELD: readonly Readonly<Record<string, unknown>>[] = JSON.parse(
  JSON.stringify(
    Array.from({ length: PAGE }, (_, index) => ({
      ...credentialOf("https://example.edu/issuers/1"),
      id: `https://example.edu/credentials/${index + 1}`,
    })),
  ),
);

/** A store whose list answers the page from memory and whose upsert keeps nothing, so that the timing is of the handler. */
const credentials: CredentialStore = {
  list: async (_owner, page) => ({ credentials: HELD.slice(page.offset, page.offset + page.limit), total: PAGE }),
  upsert: async () => "created",
};

const options: CredentialsProviderOptions = {
  api: "badges",
  credentials,
  profiles: { get: async () => undefined, put: async (_owner, profile) => profile },
  authorize: async () => ({ allowed: true, owner: OWNER }),
  serviceDescription: description("badges"),
};

/** The provider of the CLR API over the same ports. */
const clrOptions: CredentialsProviderOptions = { ...options, api: "clr", serviceDescription: description("clr") };

/** A request to an API of the provider. */
function request(method: string, path: string, body = "", type?: string, root = ROOTS.badges): HttpRequest {
  return {
    method,
    url: `${ORIGIN}${root}${path}`,
    headers: { authorization: "Bearer token", ...(type === undefined ? {} : { "content-type": type }) },
    body: encoder.encode(body),
  };
}

test("lists a page of 100 credentials and receives a CLR of 20 near JSON.stringify and JSON.parse of them", async ({
  annotate,
  bench,
}) => {
  const list = request("GET", "/credentials?limit=100");
  const listed = await handleCredentialsRequest(list, options);
  expect(listed.status).toBe(200);
  expect(JSON.parse(String(listed.body)).credential).toHaveLength(PAGE);
  const listing = await alternate(
    bench,
    "handleCredentialsRequest of a page",
    () => handleCredentialsRequest(list, options),
    {
      name: "JSON.stringify",
      run: () => JSON.stringify({ credential: HELD, compactJwsString: [] }),
    },
  );
  await expectRatioWithin(annotate, "listCredentials", "JSON.stringify of the page", listing);

  const text = JSON.stringify(clrOf(20));
  const upsert = request("POST", "/credentials", text, "application/json", ROOTS.clr);
  expect((await handleCredentialsRequest(upsert, clrOptions)).status).toBe(201);
  const receiving = await alternate(
    bench,
    "handleCredentialsRequest of an upsert",
    () => handleCredentialsRequest(upsert, clrOptions),
    { name: "JSON.parse", run: () => JSON.parse(text) },
  );
  await expectRatioWithin(annotate, "upsertCredential", "JSON.parse of the CLR", receiving);
});

test("answers a refresh near JSON.stringify of the credential", async ({ annotate, bench }) => {
  const clr: Readonly<Record<string, unknown>> = JSON.parse(JSON.stringify(clrOf(20)));
  const refresh = { refresh: async () => clr };
  const asked: HttpRequest = { method: "GET", url: `${ORIGIN}/refresh/1`, headers: {}, body: new Uint8Array() };
  expect((await handleRefreshRequest(asked, refresh)).status).toBe(200);
  const sides = await alternate(bench, "handleRefreshRequest", () => handleRefreshRequest(asked, refresh), {
    name: "JSON.stringify",
    run: () => JSON.stringify(clr),
  });
  await expectRatioWithin(annotate, "refresh", "JSON.stringify of the CLR", sides);
});
