import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LtiError } from "../src/errors.js";
import { escapeHtml, pagePolicy, readCookie, verifyJwt } from "../src/protocol/internal.js";
import { createClock, generateKeyPair, NOW, request, signToken } from "./fixture.js";
import { FUZZ } from "./fuzz.js";

describe("cookies", () => {
  it("reads the cookie of a name, and answers undefined for a name that is not there", () => {
    const get = (cookie: string, name: string) =>
      readCookie(request({ url: "https://tool.example/", headers: { cookie } }), name);
    expect(get("a=1; __Host-lti_state_x=abc; b=2", "__Host-lti_state_x")).toBe("abc");
    expect(get("a=1", "b")).toBeUndefined();
    expect(readCookie(request({ url: "https://tool.example/" }), "a")).toBeUndefined();
  });

  it("answers a string or undefined for any cookie header, and reads exactly what a well-formed pair says", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.string({ maxLength: 20 }), (cookie, name) => {
        const value = readCookie(request({ url: "https://tool.example/", headers: { cookie } }), name);
        expect(value === undefined || typeof value === "string").toBe(true);
      }),
      FUZZ,
    );
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/u),
        fc.stringMatching(/^[A-Za-z0-9_-]{0,30}$/u),
        (name, value) => {
          const header = `other=1; ${name}=${value}; last=2`;
          expect(readCookie(request({ url: "https://tool.example/", headers: { cookie: header } }), name)).toBe(value);
        },
      ),
      FUZZ,
    );
  });
});

describe("verifyJwt on text that is not a token", () => {
  const keys = async () => {
    throw new Error("No key is fetched for a token that is not one.");
  };
  const expected = { issuer: "https://lms.example.edu", audience: "tool", requiredClaims: ["exp"] };

  it("refuses any text with an LtiError or a DataError before it asks for a key", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (text) => {
        try {
          await verifyJwt(text, keys, expected, NOW);
        } catch (error) {
          expect(error instanceof LtiError || error instanceof DataError, String(error)).toBe(true);
        }
      }),
      FUZZ,
    );
  });

  it("refuses a signed token whose bytes are changed anywhere with an LtiError or a DataError", async () => {
    const key = await generateKeyPair("platform-1");
    const clock = createClock();
    const token = await signToken({ iss: expected.issuer, aud: "tool", exp: NOW / 1000 + 300, iat: NOW / 1000 }, key);
    const resolve = async () => key.publicKey;
    expect(clock.now()).toBe(NOW);
    await fc.assert(
      fc.asyncProperty(
        fc.nat(token.length - 1),
        fc.constantFrom("A", "-", "_", ".", " ", "=", "0"),
        async (at, replacement) => {
          const changed = `${token.slice(0, at)}${replacement}${token.slice(at + 1)}`;
          try {
            await verifyJwt(changed, resolve, expected, NOW);
            expect(changed).toBe(token);
          } catch (error) {
            expect(error instanceof LtiError || error instanceof DataError, String(error)).toBe(true);
          }
        },
      ),
      { ...FUZZ, numRuns: 100 },
    );
  });
});

describe("verifyJwt and the claims it names", () => {
  const issuer = "https://lms.example.edu";
  const seconds = NOW / 1000;
  const claims = { iss: issuer, aud: "tool", sub: "user-1", exp: seconds + 300, iat: seconds };

  it("accepts a token that says what is expected, and refuses a subject that differs, when the token must have one", async () => {
    const key = await generateKeyPair("platform-1");
    const resolve = async () => key.publicKey;
    const expected = { issuer, audience: "tool", subject: "user-1", requiredClaims: ["exp"] };
    expect(await verifyJwt(await signToken(claims, key), resolve, expected, NOW)).toMatchObject({ sub: "user-1" });
    const other = await signToken({ ...claims, sub: "user-2" }, key);
    await expect(verifyJwt(other, resolve, expected, NOW)).rejects.toMatchObject({
      reason: "subject-mismatch",
      status: 401,
    });
  });

  it("refuses a token that is not valid yet", async () => {
    const key = await generateKeyPair("platform-1");
    const token = await signToken({ ...claims, nbf: seconds + 3600 }, key);
    await expect(
      verifyJwt(token, async () => key.publicKey, { issuer, audience: "tool", requiredClaims: ["exp"] }, NOW),
    ).rejects.toMatchObject({ reason: "issued-in-future" });
  });
});

describe("escapeHtml", () => {
  it("encodes the five characters that end an attribute value or open a tag, each as its entity", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    for (const [text, entity] of [
      ["&", "&amp;"],
      ["<", "&lt;"],
      [">", "&gt;"],
      ['"', "&quot;"],
      ["'", "&#39;"],
    ]) {
      expect(escapeHtml(`a${text}b`), text).toBe(`a${entity}b`);
    }
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });
});

describe("pagePolicy", () => {
  it("allows nothing but the one script by its hash, and the forms that go to the given sources", async () => {
    const policy = await pagePolicy("alert(1)", "'self'", "https://lms.example.edu");
    expect(policy).toBe(
      "default-src 'none'; script-src 'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='; base-uri 'none'; form-action 'self'; frame-ancestors https://lms.example.edu",
    );
  });

  it("leaves frame-ancestors out when no origin is named", async () => {
    expect(await pagePolicy("x", "'self'")).not.toContain("frame-ancestors");
  });
});
