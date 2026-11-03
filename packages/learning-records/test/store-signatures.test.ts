import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hashAttachment, writeMultipart } from "../src/attachments/index.js";
import type { Statement } from "../src/index.js";
import { SIGNATURE_USAGE_TYPE } from "../src/signing/index.js";
import { handleLrsRequest, type LrsOptions } from "../src/store/index.js";
import { memory, optionsOf, reasonOf, requestOf } from "./memory-lrs.js";

interface Case {
  readonly title: string;
  readonly statement: Statement;
  readonly signature: string;
  readonly key?: string;
  readonly expected: { readonly valid: boolean; readonly reason?: string };
}

/** Signed Statements that jwcrypto made: `validation/xapi_signatures.py`. */
const fixture: { readonly root: string; readonly cases: readonly Case[] } = JSON.parse(
  readFileSync(new URL("./fixtures/xapi-signatures.json", import.meta.url), "utf8"),
);

const encoder = new TextEncoder();

/** Sends the Statement with its signature as the Attachment that the standard asks for. */
async function sendSigned(
  statement: Statement,
  signature: string,
  changes: Partial<LrsOptions> = {},
  header: { contentType?: string; withData?: boolean } = {},
) {
  const body = encoder.encode(signature);
  const sha2 = hashAttachment(body);
  const signed: Statement = {
    ...statement,
    attachments: [
      {
        usageType: SIGNATURE_USAGE_TYPE,
        display: { "en-US": "Signature" },
        contentType: header.contentType ?? "application/octet-stream",
        length: body.byteLength,
        sha2,
        ...(header.withData === false ? { fileUrl: "https://example.org/signature" } : {}),
      },
    ],
  };
  const message = writeMultipart(
    signed,
    header.withData === false ? [] : [{ sha2, contentType: "application/octet-stream", body }],
  );
  const store = memory();
  const response = await handleLrsRequest(
    requestOf("POST", "/statements", { headers: { "content-type": message.contentType }, body: message.body }),
    optionsOf(store, changes),
  );
  return { response, store };
}

describe("a signed Statement", () => {
  it.each(fixture.cases.map((entry) => [entry.title, entry] as const))(
    "is judged as the signature of jwcrypto is: %s",
    async (_title, entry) => {
      // An LRS has no key for a signature without a certificate in its header, so it cannot tell a good one from a bad one.
      const accepted = entry.key !== undefined || entry.expected.valid || entry.expected.reason === "no-key";
      const { response, store } = await sendSigned(entry.statement, entry.signature);
      expect(response.status, response.status === 400 ? reasonOf(response) : "").toBe(accepted ? 200 : 400);
      expect(store.held.size).toBe(accepted ? 1 : 0);
    },
  );

  it("is refused with the reason of the check, and stored with the signature when it is good", async () => {
    const forged = fixture.cases.find(({ title }) => title === "a signature with a bit changed") as Case;
    const refused = await sendSigned(forged.statement, forged.signature);
    expect(reasonOf(refused.response)).toMatch(
      /^The signature of the Statement .* does not verify against the certificate in its header\.$/u,
    );
    const other = fixture.cases.find(
      ({ title }) => title === "a statement of another actor than the one signed",
    ) as Case;
    expect(reasonOf((await sendSigned(other.statement, other.signature)).response)).toContain(
      "signs another Statement than the one received",
    );
    const algorithm = fixture.cases.find(({ title }) => title === "a JWS signed with HS256") as Case;
    expect(reasonOf((await sendSigned(algorithm.statement, algorithm.signature)).response)).toContain(
      "does not use RS256, RS384 or RS512",
    );
    const garbage = fixture.cases.find(({ title }) => title === "text that is no JWS") as Case;
    expect(reasonOf((await sendSigned(garbage.statement, garbage.signature)).response)).toContain(
      "is not a compact JWS whose payload is a Statement",
    );
    const good = fixture.cases[0] as Case;
    const stored = await sendSigned(good.statement, good.signature);
    expect(stored.response.status).toBe(200);
    expect(stored.store.data.size).toBe(1);
  });

  it("is refused when its Attachment is not application/octet-stream, or has no data in the request", async () => {
    const good = fixture.cases[0] as Case;
    const wrongType = await sendSigned(good.statement, good.signature, {}, { contentType: "text/plain" });
    expect(wrongType.response.status).toBe(400);
    expect(reasonOf(wrongType.response)).toContain(
      "an Attachment of the type application/octet-stream whose data come with the request",
    );
    const noData = await sendSigned(good.statement, good.signature, {}, { withData: false });
    expect(noData.response.status).toBe(400);
  });

  it("asks trustCertificate about the chain of the header, leaf first, and refuses a chain that it does not trust", async () => {
    const good = fixture.cases[0] as Case;
    const asked: (readonly string[])[] = [];
    const controller = new AbortController();
    const trusting = async (chain: readonly string[], options?: { signal?: AbortSignal }) => {
      asked.push(chain);
      expect(options?.signal).toBe(controller.signal);
      return false;
    };
    const { response } = await sendSigned(good.statement, good.signature, {
      trustCertificate: trusting,
      signal: controller.signal,
    });
    expect(response.status).toBe(400);
    expect(reasonOf(response)).toContain("is not trusted");
    expect(asked).toHaveLength(1);
    expect(asked[0]?.at(-1)).toBe(fixture.root);
    const trusted = await sendSigned(good.statement, good.signature, { trustCertificate: async () => true });
    expect(trusted.response.status).toBe(200);
  });

  it("verifies a signature that a Statement names twice once", async () => {
    const good = fixture.cases[0] as Case;
    const body = encoder.encode(good.signature);
    const header = {
      usageType: SIGNATURE_USAGE_TYPE,
      display: { "en-US": "Signature" },
      contentType: "application/octet-stream",
      length: body.byteLength,
      sha2: hashAttachment(body),
    };
    const message = writeMultipart({ ...good.statement, attachments: [header, header] }, [
      { sha2: header.sha2, contentType: header.contentType, body },
    ]);
    let asked = 0;
    const response = await handleLrsRequest(
      requestOf("POST", "/statements", { headers: { "content-type": message.contentType }, body: message.body }),
      optionsOf(memory(), {
        trustCertificate: async () => {
          asked += 1;
          return true;
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(asked).toBe(1);
  });

  it("answers 500 when trustCertificate rejects", async () => {
    const good = fixture.cases[0] as Case;
    const { response } = await sendSigned(good.statement, good.signature, {
      trustCertificate: () => Promise.reject(new Error("down")),
    });
    expect(response.status).toBe(500);
  });
});

describe("the signatures of a request", () => {
  const actor = { mbox: "mailto:learner@example.org" };
  const verb = { id: "http://adlnet.gov/expapi/verbs/completed" };
  const object = { id: "https://example.org/activities/course-1" };
  const base64url = (text: string) => Buffer.from(text).toString("base64url");

  /**
   * A JWS with no chain, which the LRS takes when its payload is the Statement, since it has no key, and whose payload carries a
   * definition of its Activity, which the comparison of Statements leaves out.
   */
  function signatureOf(definition: object): { readonly jws: string; readonly sha2: string } {
    const payload = { actor, verb, object: { ...object, definition } };
    const jws = `${base64url('{"alg":"RS256"}')}.${base64url(JSON.stringify(payload))}.${base64url("signature")}`;
    return { jws, sha2: hashAttachment(encoder.encode(jws)) };
  }

  /** Posts Statements that each name the signature, with its data in one part. */
  function post(
    signature: { readonly jws: string; readonly sha2: string },
    statements: number,
    changes: Partial<LrsOptions>,
  ) {
    const header = {
      usageType: SIGNATURE_USAGE_TYPE,
      display: { "en-US": "Signature" },
      contentType: "application/octet-stream",
      length: signature.jws.length,
      sha2: signature.sha2,
    };
    const batch = Array.from({ length: statements }, () => ({ actor, verb, object, attachments: [header] }));
    const message = writeMultipart(batch, [
      { sha2: signature.sha2, contentType: "application/octet-stream", body: encoder.encode(signature.jws) },
    ]);
    const store = memory();
    const response = handleLrsRequest(
      requestOf("POST", "/statements", { headers: { "content-type": message.contentType }, body: message.body }),
      optionsOf(store, changes),
    );
    return { response, store, bytes: message.body.byteLength };
  }

  it("refuses with 413 the bytes of the signatures, counted once for each Statement that names them, above the limit of a body", async () => {
    const signature = signatureOf({ description: { en: "x".repeat(4000) } });
    const allowed = post(signature, 2, {});
    expect((await allowed.response).status).toBe(200);
    const maxBodyBytes = 4 * signature.jws.length;
    const over = post(signature, 5, { limits: { maxBodyBytes } });
    expect(over.bytes).toBeLessThan(maxBodyBytes);
    const response = await over.response;
    expect(response.status).toBe(413);
    expect(reasonOf(response)).toBe(
      `The signatures of the Statements have ${5 * signature.jws.length} bytes, counted once for each Statement that names them, above the limit of ${maxBodyBytes} bytes.`,
    );
    expect(over.store.held.size).toBe(0);
  });

  it("reads the payload of a signature within the depth and the tokens of the limits of a request", async () => {
    const signature = signatureOf({ extensions: { "https://example.org/extensions/scores": Array(200).fill(0) } });
    expect((await post(signature, 1, {}).response).status).toBe(200);
    const tokens = await post(signature, 1, { limits: { maxTokens: 300 } }).response;
    expect(tokens.status).toBe(400);
    expect(reasonOf(tokens)).toMatch(
      /^The signature of the Statement .* is not a compact JWS whose payload is a Statement\.$/u,
    );
    const deep = signatureOf({ extensions: { "https://example.org/extensions/nested": [[[[[0]]]]] } });
    expect((await post(deep, 1, {}).response).status).toBe(200);
    expect((await post(deep, 1, { limits: { maxDepth: 8 } }).response).status).toBe(400);
  });
});
