// biome-ignore-all lint/style/useNamingConvention: the names of OAuth 2.0 answers and of NRPS and AGS bodies are snake_case.

import { SCOPES } from "@interopkit/tool-integration";
import { createServiceClient } from "@interopkit/tool-integration/tool";
import { expect, test } from "vitest";
import { CLIENT_ID, CLOCK, createPair, DEPLOYMENT_ID, ISSUER } from "./bench-setup.js";
import { expectRatioInTurns, PAGE_SIZE } from "./budgets.js";

const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
const MEMBERS_URL = `${ISSUER}/contexts/course-1/memberships`;
const LINE_ITEMS_URL = `${ISSUER}/contexts/course-1/line-items`;
const LINE_ITEM_URL = `${LINE_ITEMS_URL}/quiz-1`;

/** The members of a course as the platform writes them: names, an email address, a picture and a source identifier each. */
const MEMBERS = JSON.stringify({
  id: MEMBERS_URL,
  context: { id: "course-1", label: "C1", title: "Course 1" },
  members: Array.from({ length: PAGE_SIZE }, (_, index) => ({
    status: "Active",
    name: `Learner ${index}`,
    picture: `${ISSUER}/people/${index}.png`,
    given_name: "Learner",
    family_name: `${index}`,
    email: `learner${index}@example.edu`,
    user_id: `user-${index}`,
    lis_person_sourcedid: `sourced-${index}`,
    roles: [LEARNER],
  })),
});

/** The results of a line item as the platform writes them. */
const RESULTS = JSON.stringify(
  Array.from({ length: PAGE_SIZE }, (_, index) => ({
    id: `${LINE_ITEM_URL}/results?user_id=user-${index}`,
    scoreOf: LINE_ITEM_URL,
    userId: `user-${index}`,
    resultScore: index % 11,
    resultMaximum: 10,
    comment: "Good work",
  })),
);

/** The line items of a course as the platform writes them: a label, a maximum, a tag, a resource and a window each. */
const LINE_ITEMS = JSON.stringify(
  Array.from({ length: PAGE_SIZE }, (_, index) => ({
    id: `${LINE_ITEMS_URL}/item-${index}`,
    label: `Quiz ${index}`,
    scoreMaximum: 10,
    resourceLinkId: `link-${index}`,
    resourceId: `quiz-${index}`,
    tag: "grade",
    startDateTime: "2023-11-01T00:00:00Z",
    endDateTime: "2023-12-01T00:00:00Z",
    gradesReleased: true,
  })),
);

/** The text and the media type of each page that the platform answers, by its path. */
const PAGES = new Map<string, readonly [string, string]>([
  [new URL(MEMBERS_URL).pathname, [MEMBERS, "application/vnd.ims.lti-nrps.v2.membershipcontainer+json"]],
  [new URL(LINE_ITEMS_URL).pathname, [LINE_ITEMS, "application/vnd.ims.lis.v2.lineitemcontainer+json"]],
  [`${new URL(LINE_ITEM_URL).pathname}/results`, [RESULTS, "application/vnd.ims.lis.v2.resultcontainer+json"]],
]);

/** A tool whose service client reads the pages from a platform that answers with these texts. */
async function client() {
  const pair = await createPair("RS256");
  const answer = (url: string): Response => {
    if (url === pair.registration.accessTokenUrl) {
      return Response.json({
        access_token: "token-1",
        token_type: "Bearer",
        expires_in: 3600,
        scope: `${SCOPES.contextMembershipReadonly} ${SCOPES.resultReadonly} ${SCOPES.lineitemReadonly}`,
      });
    }
    const [text, type] = PAGES.get(new URL(url).pathname) ?? ["", "text/plain"];
    return new Response(text, { headers: { "content-type": type } });
  };
  return createServiceClient(
    { issuer: ISSUER, clientId: CLIENT_ID, deploymentId: DEPLOYMENT_ID },
    {
      registration: async () => pair.registration,
      clock: CLOCK,
      fetch: async (url) => answer(url),
      scopes: [SCOPES.contextMembershipReadonly, SCOPES.resultReadonly, SCOPES.lineitemReadonly],
    },
  );
}

test("reads a page of 1,000 members within a multiple of JSON.parse of its text", async ({ annotate, bench }) => {
  const service = await client();
  expect((await service.members(MEMBERS_URL)).items).toHaveLength(PAGE_SIZE);
  await annotate(`The page has ${PAGE_SIZE} members and ${new TextEncoder().encode(MEMBERS).length} bytes of JSON.`);
  await expectRatioInTurns(
    { annotate, bench },
    "members",
    { name: "JSON.parse", fn: () => JSON.parse(MEMBERS) },
    { name: "members", fn: () => service.members(MEMBERS_URL) },
  );
});

test("reads a page of 1,000 results within a multiple of JSON.parse of its text", async ({ annotate, bench }) => {
  const service = await client();
  expect((await service.results(LINE_ITEM_URL)).items).toHaveLength(PAGE_SIZE);
  await annotate(`The page has ${PAGE_SIZE} results and ${new TextEncoder().encode(RESULTS).length} bytes of JSON.`);
  await expectRatioInTurns(
    { annotate, bench },
    "results",
    { name: "JSON.parse", fn: () => JSON.parse(RESULTS) },
    { name: "results", fn: () => service.results(LINE_ITEM_URL) },
  );
});

test("reads a page of 1,000 line items within a multiple of JSON.parse of its text", async ({ annotate, bench }) => {
  const service = await client();
  expect((await service.lineItems(LINE_ITEMS_URL)).items).toHaveLength(PAGE_SIZE);
  await annotate(
    `The page has ${PAGE_SIZE} line items and ${new TextEncoder().encode(LINE_ITEMS).length} bytes of JSON.`,
  );
  await expectRatioInTurns(
    { annotate, bench },
    "lineItems",
    { name: "JSON.parse", fn: () => JSON.parse(LINE_ITEMS) },
    { name: "lineItems", fn: () => service.lineItems(LINE_ITEMS_URL) },
  );
});
