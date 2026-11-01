import { createCaseClient } from "@interopkit/competency-frameworks/client";
import { ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { alignments, type Copies, changesBetween, outline, syncFrameworks } from "../src/consumer.ts";
import { pacingGuide } from "../src/district.ts";
import { identifierOf } from "../src/identifiers.ts";
import { MATHEMATICS, MINISTRY_ORIGIN, mathematics2024, mathematics2025 } from "../src/ministry.ts";
import { ministry } from "./ministry-fixture.ts";

describe("synchronizing frameworks", () => {
  it("keeps a copy that is as new as the document, and replaces one that the provider changed after it", async () => {
    const { client, catalog } = ministry();
    const copies: Copies = new Map();
    await syncFrameworks(client, copies);
    const held = copies.get(identifierOf(MATHEMATICS.document));
    catalog.publish(mathematics2025());
    const report = await syncFrameworks(client, copies);
    expect(report.fetched).toStrictEqual(["Mathematics, Grade 3"]);
    expect(copies.get(identifierOf(MATHEMATICS.document))).not.toBe(held);
    expect(copies.get(identifierOf(MATHEMATICS.document))?.CFDocument.version).toBe("2025");
  });

  it("fetches only the documents that the query selects", async () => {
    const { client } = ministry();
    const copies: Copies = new Map();
    const report = await syncFrameworks(client, copies, {
      filter: { field: "title", predicate: "~", value: "english" },
    });
    expect(report.fetched).toStrictEqual(["English Language Arts, Grade 3"]);
    expect(copies.size).toBe(1);
  });

  it("leaves out a framework that is gone by the time it is fetched, and holds no copy of it", async () => {
    const { provider } = ministry();
    const client = createCaseClient({
      baseUrl: MINISTRY_ORIGIN,
      fetch: (url, init) =>
        url.includes("/CFPackages/") ? Promise.resolve(new Response(null, { status: 404 })) : provider.fetch(url, init),
    });
    const copies: Copies = new Map();
    expect(await syncFrameworks(client, copies)).toStrictEqual({ fetched: [], current: [] });
    expect(copies.size).toBe(0);
  });

  it("rejects with the failure of the provider and keeps the copies it has", async () => {
    const { client } = ministry();
    const copies: Copies = new Map();
    await syncFrameworks(client, copies);
    const failing = createCaseClient({
      baseUrl: MINISTRY_ORIGIN,
      fetch: () => Promise.resolve(new Response("busy", { status: 503 })),
    });
    const error = await syncFrameworks(failing, copies).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 503 });
    expect(copies.size).toBe(2);
  });

  it("ends when the signal aborts, with its reason, and fetches nothing", async () => {
    const { client } = ministry();
    const copies: Copies = new Map();
    const reason = new Error("The job was cancelled.");
    await expect(syncFrameworks(client, copies, {}, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(copies.size).toBe(0);
  });
});

describe("reading a framework", () => {
  it("writes one line for each item, indented by its depth", () => {
    expect(outline(mathematics2024())).toHaveLength(6);
    expect(outline(mathematics2024())[1]?.startsWith("  NF.1 ")).toBe(true);
  });

  it("outlines a framework with no items as nothing", () => {
    expect(outline({ ...mathematics2024(), CFItems: [], CFAssociations: [] })).toStrictEqual([]);
  });

  it("finds no alignment when the other framework holds none of the items", () => {
    const lines = alignments(pacingGuide(), { ...mathematics2024(), CFItems: [] });
    expect(lines).toStrictEqual([]);
  });

  it("finds no change between an edition and itself", () => {
    expect(changesBetween(mathematics2024(), mathematics2024())).toStrictEqual({
      added: [],
      changed: [],
      replaced: [],
    });
  });
});
