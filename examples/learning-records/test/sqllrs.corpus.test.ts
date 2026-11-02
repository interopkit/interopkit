import type { Fetch } from "@interopkit/core";
import { signerFromCryptoKey } from "@interopkit/core";
import type { Statement } from "@interopkit/learning-records";
import { createLrsClient } from "@interopkit/learning-records/client";
import { signStatement, verifyStatementSignature } from "@interopkit/learning-records/signing";
import { describe, expect, it } from "vitest";
import { ANA, BUDI, ORIGIN, STATISTICS } from "../src/campus.ts";
import { clientFor } from "../src/clients.ts";
import { activityOf, completions } from "../src/dashboard.ts";
import { readProgress, saveProgress, sendCertificate, sendCourse, voidMistake } from "../src/platform.ts";

const LRS = process.env.SQLLRS_URL ?? "";
const CREDENTIAL = { user: process.env.SQLLRS_USER ?? "", password: process.env.SQLLRS_PASSWORD ?? "" };

/** A `fetch` for the client: its address is `https`, and SQL LRS listens on loopback over `http`, so each call is sent there. */
const toSqlLrs: Fetch = (url, init) => {
  const target = new URL(url);
  return fetch(`${LRS}${target.pathname}${target.search}`, init);
};

const client = clientFor(toSqlLrs, CREDENTIAL);
const at = (minutes: number): string =>
  new Date(Date.parse("2026-03-02T08:00:00.000Z") + minutes * 60_000).toISOString();
const ATTEMPT = "33333333-3333-4333-8333-333333333333";

describe("the platform and the dashboard against SQL LRS", () => {
  it("says it speaks 2.0.0 and 1.0.3", async () => {
    expect((await client.about()).version).toStrictEqual(["2.0.0", "1.0.3"]);
  });

  it("stores the three Statements of a course, and a resend of the batch is the same Statements", async () => {
    const first = await sendCourse(client, ANA, ATTEMPT, [at(1), at(2), at(3)]);
    const again = await sendCourse(client, ANA, ATTEMPT, [at(1), at(2), at(3)]);
    expect(first.ids).toHaveLength(3);
    expect(again.ids).toStrictEqual(first.ids);
    const found = await client.getStatement(first.ids[0] ?? "");
    expect(found?.verb.id).toBe("http://adlnet.gov/expapi/verbs/launched");
    expect(found?.authority).toBeDefined();
    expect(found?.stored).toBeDefined();
  });

  it("answers a query in pages and the verbs of a learner as ids, and hides a voided Statement from a query by id", async () => {
    await sendCourse(client, BUDI, "44444444-4444-4444-8444-444444444444", [at(4), at(5), at(6)], {
      nameInIndonesian: true,
    });
    const mistake = await voidMistake(client, BUDI, { account: { homePage: ORIGIN, name: "platform" } }, at(7));
    expect(await client.getStatement(mistake)).toBeUndefined();
    expect((await client.getStatement(mistake, { voided: true }))?.id).toBe(mistake);
    const report = await completions(client, 1);
    expect(report.learners).toStrictEqual(["Ana", "Budi"]);
    expect(report.pages).toBeGreaterThanOrEqual(2);
    expect(await activityOf(client, ANA)).toStrictEqual(["completed", "answered", "launched"]);
  });

  it("stores a signed Statement, and what it returns verifies against the key; one with another Attachment is refused", async () => {
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const signer = signerFromCryptoKey(privateKey, { algorithm: "RS256" });
    const plain: Statement = {
      id: "90000000-0000-4000-8000-000000000001",
      actor: ANA,
      verb: { id: "https://campus.example/verbs/earned" },
      object: { id: "https://campus.example/certificates/plain" },
      timestamp: at(8),
    };
    const signed = await signStatement(plain, signer);
    await client.sendStatement(signed.statement, { attachments: [signed.signature] });
    const returned = await client.getStatement(plain.id ?? "", { attachments: true });
    const signature = returned?.attachments.get(returned.statement.attachments?.[0]?.sha2 ?? "");
    expect(
      await verifyStatementSignature(plain, signature?.body ?? new Uint8Array(), { key: publicKey }),
    ).toStrictEqual({
      valid: true,
      certified: false,
    });
    // SQL LRS compares the payload with the Statement without its Attachments, so a signed Statement that has another one
    // fails, though the standard signs the complete Statement.
    await expect(sendCertificate(client, ANA, signer, at(9))).rejects.toMatchObject({ status: 400 });
  });

  it("gives the Activity with the languages of every Statement, and the Person of an Agent", async () => {
    const course = await client.getActivity(STATISTICS);
    expect(course.definition?.name).toStrictEqual({ "en-US": "Statistics 101", "id-ID": "Statistika 101" });
    const person = await client.getPerson(ANA);
    expect(person.mbox).toStrictEqual([ANA.mbox]);
  });

  it("keeps progress under ETags: the tag that was read replaces, a stale one and a second create are 412", async () => {
    expect((await saveProgress(client, ANA, 3)).outcome).toBe("written");
    const read = await readProgress(client, ANA);
    expect(read?.page).toBe(3);
    expect((await saveProgress(client, ANA, 5, read?.tag)).outcome).toBe("written");
    expect((await saveProgress(client, ANA, 4, read?.tag)).outcome).toBe("precondition-failed");
    expect((await saveProgress(client, ANA, 1)).outcome).toBe("precondition-failed");
    expect((await readProgress(client, ANA))?.page).toBe(5);
  });

  it("merges a JSON write, lists the ids of a context, and removes a document and every state", async () => {
    const preferences = { resource: "agent-profile", agent: ANA, profileId: "preferences" } as const;
    const json = (value: unknown) => ({
      contentType: "application/json",
      body: new TextEncoder().encode(JSON.stringify(value)),
    });
    await client.putDocument(preferences, json({ theme: "dark", language: "en" }), {
      precondition: { ifNoneMatch: "*" },
    });
    const stored = await client.getDocument(preferences);
    await client.postDocument(preferences, { language: "id" }, { precondition: { ifMatch: stored?.etag ?? "" } });
    const merged = await client.getDocument(preferences);
    expect(JSON.parse(new TextDecoder().decode(merged?.body))).toStrictEqual({ theme: "dark", language: "id" });
    expect(await client.listDocumentIds({ resource: "agent-profile", agent: ANA })).toContain("preferences");
    expect(await client.deleteDocument(preferences, { precondition: { ifMatch: merged?.etag ?? "" } })).toBe("written");
    expect(await client.getDocument(preferences)).toBeUndefined();
    await client.deleteStates({ resource: "state", activityId: STATISTICS, agent: ANA });
    expect(await client.listDocumentIds({ resource: "state", activityId: STATISTICS, agent: ANA })).toStrictEqual([]);
  });
});

describe("the client of xAPI 1.0.3 against SQL LRS", () => {
  const legacy = createLrsClient({
    endpoint: `${ORIGIN}/xapi/`,
    fetch: toSqlLrs,
    version: "1.0.3",
    authorization: async () => `Basic ${btoa(`${CREDENTIAL.user}:${CREDENTIAL.password}`)}`,
  });

  it("reads on the 1.0.3 route a Statement that was stored through 2.0", async () => {
    const course = await sendCourse(client, ANA, "55555555-5555-4555-8555-555555555555", [at(10), at(11), at(12)]);
    const found = await legacy.getStatement(course.ids[2] ?? "");
    expect(found?.verb.id).toBe("http://adlnet.gov/expapi/verbs/completed");
  });

  it("writes State with no precondition, which 1.0.3 allows, but SQL LRS answers 409 for a second write on that route too", async () => {
    const target = { resource: "state", activityId: STATISTICS, agent: BUDI, stateId: "legacy" } as const;
    const body = new TextEncoder().encode("one");
    expect(await legacy.putDocument(target, { contentType: "text/plain", body })).toBe("written");
    expect(await legacy.putDocument(target, { contentType: "text/plain", body })).toBe("conflict");
    expect((await legacy.getDocument(target))?.body).toStrictEqual(body);
  });

  it("is refused for a Statement that carries version 2.0.0, which the 1.0.3 route does not take", async () => {
    await expect(
      sendCourse(legacy, ANA, "66666666-6666-4666-8666-666666666666", [at(13), at(14), at(15)]),
    ).rejects.toMatchObject({
      status: 400,
    });
  });
});
