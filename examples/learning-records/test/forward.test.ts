import { createCryptoKeySigner } from "@interopkit/core";
import { buildStatement, isSameStatement, type Statement } from "@interopkit/learning-records";
import { createLrsClient, type LrsClient } from "@interopkit/learning-records/client";
import { signStatement, verifyStatementSignature } from "@interopkit/learning-records/signing";
import { describe, expect, it } from "vitest";
import { createLrs, type Lrs } from "../src/lrs.ts";

const ACTIONS = ["statements.read", "statements.write"] as const;
const LEARNER = { mbox: "mailto:ana@campus.example" };
const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);

/** An LRS with a client of its own. */
function lrsAt(origin: string): { readonly lrs: Lrs; readonly client: (version?: "2.0.0" | "1.0.3") => LrsClient } {
  const authority = { account: { homePage: origin, name: "forwarder" } };
  const lrs = createLrs({ origin, credentials: [{ user: "suite", password: "secret", authority, actions: ACTIONS }] });
  return {
    lrs,
    client: (version = "2.0.0") =>
      createLrsClient({
        endpoint: `${origin}/xapi/`,
        fetch: lrs.fetch,
        version,
        authorization: async () => `Basic ${btoa("suite:secret")}`,
      }),
  };
}

/** A Statement of a course that happened at a time, in a version. */
function statementOf(id: string, version: "2.0.0" | "1.0.3" = "2.0.0"): Statement {
  return buildStatement(
    {
      id,
      actor: LEARNER,
      verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
      object: { id: "https://campus.example/courses/a" },
      timestamp: "2026-03-02T08:00:00.000Z",
    },
    { version },
  );
}

describe("forwarding from one LRS to another", () => {
  it("keeps the id and the content of each Statement, the data of its Attachments, and its signature", async () => {
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const source = lrsAt("https://source.example");
    const target = lrsAt("https://target.example");
    const signed = await signStatement(
      statementOf(ids[0] as string),
      createCryptoKeySigner(privateKey, { algorithm: "RS256" }),
    );
    await source.client().sendStatements([signed.statement], { attachments: [signed.signature] });
    await source.client("1.0.3").sendStatement(statementOf(ids[1] as string, "1.0.3"));
    await source.client().sendStatement(statementOf(ids[2] as string));

    const forwarded: Statement[] = [];
    for await (const { statements, attachments } of source
      .client()
      .queryStatements({ format: "exact", attachments: true, ascending: true })) {
      await target.client().sendStatements(statements, { attachments: [...attachments.values()], role: "lrs" });
      forwarded.push(...statements);
    }

    expect(forwarded.map(({ id }) => id)).toStrictEqual(ids);
    const first = await target.client().getStatement(ids[0] as string, { attachments: true });
    const data = first?.attachments.get(signed.signature.sha2);
    expect(first === undefined || data === undefined).toBe(false);
    if (first === undefined || data === undefined) return;
    expect(isSameStatement(first.statement, signed.statement)).toBe(true);
    expect(await verifyStatementSignature(first.statement, data.body, { key: publicKey })).toStrictEqual({
      valid: true,
      certified: false,
    });
    expect((await target.client().getStatement(ids[1] as string))?.version).toBe("1.0.0");
  });

  it("goes on from the page that a forwarder kept before it stopped", async () => {
    const source = lrsAt("https://source.example");
    await source.client().sendStatements(ids.map((id) => statementOf(id)));
    const pages = source.client().queryStatements({ limit: 1, ascending: true });
    let kept: string | undefined;
    for await (const page of pages) {
      kept = page.more;
      break;
    }
    expect(kept).toBeDefined();
    const rest: (string | undefined)[] = [];
    for await (const { statements } of source.client().moreStatements(kept ?? "")) {
      rest.push(...statements.map(({ id }) => id));
    }
    expect(rest).toStrictEqual(ids.slice(1));
  });
});
