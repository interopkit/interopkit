// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of AGS bodies are camelCase or snake_case by the specifications.

import type { Fetch } from "@interopkit/core";
import { expect } from "vitest";
import { type FakePlatform, ISSUER } from "./fake-platform.js";
import { textOf } from "./text-of.js";

export const CONTAINER_URL = `${ISSUER}/2344/lineitems`;
export const LINE_ITEM_URL = `${CONTAINER_URL}/1234/lineitem`;
const LINE_ITEM_TYPE = "application/vnd.ims.lis.v2.lineitem+json";
const CONTAINER_TYPE = "application/vnd.ims.lis.v2.lineitemcontainer+json";
const RESULTS_TYPE = "application/vnd.ims.lis.v2.resultcontainer+json";
const SCORE_TYPE = "application/vnd.ims.lis.v1.score+json";
export const SUBJECT = "a6d5c443-1f51-4783-ba1a-7686ffe3b54a";

const ACTIVITY_PROGRESS = ["Initialized", "Started", "InProgress", "Submitted", "Completed"];
const GRADING_PROGRESS = ["FullyGraded", "Pending", "PendingManual", "Failed", "NotReady"];
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+(?:Z|[+-]\d{2}(?::?\d{2})?)$/u;

/** A body that the learning platform received, as the tool sent it. */
export type Received = Record<string, unknown>;

/**
 * The learning platform's grade services for a tool that has been launched, as LTI AGS 2.0 sections 3.2 to 3.4 describe them:
 * the token endpoint and the key set of `FakePlatform`, a container of line items with the `next` links of section 3.2, a
 * line item, its results and its scores. It checks what the specification says a platform may rely on: the bearer token and the
 * media types, a `userId`, a timestamp with a sub-second part and a zone, the values of the two progress properties,
 * `scoreGiven` from 0 with a `scoreMaximum` above 0, and that the timestamp grows. It is written from the specification, not from
 * the code under test.
 */
export class FakeLms {
  /** The scores it kept, in order, with an older one dropped as the specification allows. */
  readonly accepted: Received[] = [];
  /** Every score that reached it, kept or not. */
  readonly received: Received[] = [];
  /** The calls to the services, as `METHOD url`, and the bearer token of each. */
  readonly calls: string[] = [];
  readonly tokens: string[] = [];
  /** The line items of the container, in order; the first is the line item of the launch. */
  readonly lineItems: Received[] = [
    { id: LINE_ITEM_URL, label: "Exam", scoreMaximum: 100, resourceLinkId: "200d101f-2c14-434a-a0f3-57c2a42369fd" },
    { id: `${CONTAINER_URL}/1235/lineitem`, label: "Essay", scoreMaximum: 50, tag: "originality" },
  ];
  /** Answers every call of a service with this answer while set. */
  answer: (() => Response) | undefined;
  /** The `Link` header of a page of the container while set, in place of the one to the next page of the same origin. */
  nextLink: string | undefined;
  /** The platform whose token endpoint and key set the tool uses. */
  readonly platform: FakePlatform;
  /** The access token that the services take. */
  validToken = "access-token-1";
  private lastTimestamp = Number.NEGATIVE_INFINITY;

  constructor(platform: FakePlatform) {
    this.platform = platform;
  }

  /** The `fetch` of the tool: the platform's, and the grade services. */
  readonly fetch: Fetch = async (url, init) => {
    if (!url.startsWith(CONTAINER_URL)) return this.platform.fetch(url, init);
    expect(init.redirect).toBe("manual");
    this.calls.push(`${init.method} ${url}`);
    const token = /^Bearer (.+)$/u.exec(init.headers.authorization ?? "")?.[1] ?? "";
    this.tokens.push(token);
    if (token !== this.validToken) return new Response("", { status: 401 });
    if (this.answer !== undefined) return this.answer();
    const { pathname, search } = new URL(url);
    const path = `${ISSUER}${pathname}`;
    if (path === CONTAINER_URL) return this.container(url, init);
    if (path === `${LINE_ITEM_URL}/results`) return this.results(search, init);
    if (path === `${LINE_ITEM_URL}/scores`) return this.scores(init);
    return this.lineItem(path, init);
  };

  private container(url: string, init: Parameters<Fetch>[1]): Response {
    if (init.method === "POST") {
      expect(init.headers["content-type"]).toBe(LINE_ITEM_TYPE);
      const item = {
        ...JSON.parse(textOf(init.body ?? "")),
        id: `${CONTAINER_URL}/${this.lineItems.length + 1234}/lineitem`,
      };
      this.lineItems.push(item);
      return Response.json(item, { status: 201, headers: { "content-type": LINE_ITEM_TYPE } });
    }
    expect(init.method).toBe("GET");
    expect(init.headers.accept).toBe(CONTAINER_TYPE);
    const search = new URL(url).searchParams;
    const limit = Number(search.get("limit") ?? "100");
    const start = Number(search.get("p") ?? "0");
    const tag = search.get("tag");
    const items = this.lineItems.filter((item) => tag === null || item.tag === tag);
    const page = items.slice(start, start + limit);
    const nextUrl = new URL(url);
    nextUrl.searchParams.set("p", String(start + limit));
    const link =
      this.nextLink ??
      (start + limit < items.length ? `<${nextUrl.pathname}${nextUrl.search}>; rel="next"` : undefined);
    return Response.json(page, {
      headers: { "content-type": CONTAINER_TYPE, ...(link === undefined ? {} : { link }) },
    });
  }

  private lineItem(path: string, init: Parameters<Fetch>[1]): Response {
    const index = this.lineItems.findIndex((item) => item.id === path);
    if (index === -1) return new Response("", { status: 404 });
    if (init.method === "DELETE") {
      this.lineItems.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    if (init.method === "PUT") {
      expect(init.headers["content-type"]).toBe(LINE_ITEM_TYPE);
      this.lineItems[index] = { ...JSON.parse(textOf(init.body ?? "")), id: path };
    } else {
      expect(init.method).toBe("GET");
    }
    expect(init.headers.accept).toBe(LINE_ITEM_TYPE);
    return Response.json(this.lineItems[index], { headers: { "content-type": LINE_ITEM_TYPE } });
  }

  private results(search: string, init: Parameters<Fetch>[1]): Response {
    expect(init.method).toBe("GET");
    expect(init.headers.accept).toBe(RESULTS_TYPE);
    const userId = new URLSearchParams(search).get("user_id");
    const results = this.accepted
      .filter((score) => userId === null || score.userId === userId)
      .map((score) => ({
        id: `${LINE_ITEM_URL}/results/${String(score.userId)}`,
        scoreOf: LINE_ITEM_URL,
        userId: score.userId,
        resultScore: score.scoreGiven ?? null,
        resultMaximum: score.scoreMaximum ?? null,
      }));
    return Response.json(results, { headers: { "content-type": RESULTS_TYPE } });
  }

  private scores(init: Parameters<Fetch>[1]): Response {
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe(SCORE_TYPE);
    const score: Received = JSON.parse(textOf(init.body ?? ""));
    this.received.push(score);
    expect(score.userId, "the userId").toBe(SUBJECT);
    expect(String(score.timestamp)).toMatch(TIMESTAMP);
    expect(ACTIVITY_PROGRESS).toContain(score.activityProgress);
    expect(GRADING_PROGRESS).toContain(score.gradingProgress);
    if (score.scoreGiven !== undefined) {
      expect(typeof score.scoreGiven === "number" && score.scoreGiven >= 0, "scoreGiven from 0").toBe(true);
      expect(typeof score.scoreMaximum === "number" && score.scoreMaximum > 0, "scoreMaximum above 0").toBe(true);
    }
    const time = Date.parse(String(score.timestamp));
    // The platform must not update a result when the last timestamp on record is later than the incoming score.
    if (time >= this.lastTimestamp) {
      this.lastTimestamp = time;
      this.accepted.push(score);
    }
    return new Response(null, { status: 204 });
  }
}
