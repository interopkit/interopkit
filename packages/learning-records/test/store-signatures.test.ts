import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attachmentHash, writeMultipart } from "../src/attachments/index.js";
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
  const sha2 = attachmentHash(body);
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

  it("answers 500 when trustCertificate rejects", async () => {
    const good = fixture.cases[0] as Case;
    const { response } = await sendSigned(good.statement, good.signature, {
      trustCertificate: () => Promise.reject(new Error("down")),
    });
    expect(response.status).toBe(500);
  });
});
