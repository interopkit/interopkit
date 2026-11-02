import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LtiError } from "../src/errors.js";
import {
  escapeHtml,
  pagePolicy,
  readCookie,
  renderPage,
  unverifiedClaims,
  verifyJwt,
} from "../src/protocol/internal.js";
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

describe("verifyJwt and the audiences of a token", () => {
  const issuer = "https://lms.example.edu";
  const seconds = NOW / 1000;
  const claims = { iss: issuer, aud: "tool", exp: seconds + 300, iat: seconds };
  const expected = { issuer, audience: "tool", requiredClaims: ["exp"] };

  /** Verifies a token with the claims against the expectation, with a key pair made for the test. */
  async function verify(
    change: Record<string, unknown>,
    rules: Partial<typeof expected & Record<string, unknown>> = {},
  ) {
    const key = await generateKeyPair("platform-1");
    const token = await signToken({ ...claims, ...change }, key);
    return verifyJwt(token, async () => key.publicKey, { ...expected, ...rules }, NOW);
  }

  it("accepts the audience as a string, a list of one, and a list that names it twice", async () => {
    for (const aud of ["tool", ["tool"], ["tool", "tool"]]) {
      expect(await verify({ aud }), JSON.stringify(aud)).toMatchObject({ iss: issuer });
    }
  });

  it("refuses an audience that does not hold the audience of the token", async () => {
    for (const aud of ["other", ["other"], [], 5]) {
      await expect(verify({ aud }), JSON.stringify(aud)).rejects.toMatchObject({
        reason: "audience-mismatch",
        status: 401,
      });
    }
  });

  it("refuses another audience beside it unless the registration trusts that audience, as audience-untrusted", async () => {
    const aud = ["tool", "https://lms.example.edu/token"];
    await expect(verify({ aud })).rejects.toMatchObject({ reason: "audience-untrusted", status: 401 });
    expect(await verify({ aud }, { trustedAudiences: ["https://lms.example.edu/token"] })).toMatchObject({
      iss: issuer,
    });
    await expect(verify({ aud }, { trustedAudiences: ["https://elsewhere.example/"] })).rejects.toMatchObject({
      reason: "audience-untrusted",
    });
  });

  it("requires the authorized party of a token with several audiences, and that it names the expected party", async () => {
    const rules = { trustedAudiences: ["extra"], authorizedParty: "tool" };
    const aud = ["tool", "extra"];
    await expect(verify({ aud }, rules)).rejects.toMatchObject({ reason: "authorized-party-missing", status: 401 });
    expect(await verify({ aud, azp: "tool" }, rules)).toMatchObject({ azp: "tool" });
    await expect(verify({ aud, azp: "extra" }, rules)).rejects.toMatchObject({ reason: "authorized-party-mismatch" });
    await expect(verify({ aud, azp: 5 }, rules)).rejects.toMatchObject({ reason: "claim-invalid" });
    expect(await verify({ aud: "tool" }, rules)).toMatchObject({ aud: "tool" });
    expect(await verify({ aud: "tool", azp: "tool" }, rules)).toMatchObject({ azp: "tool" });
    await expect(verify({ aud: "tool", azp: "extra" }, rules)).rejects.toMatchObject({
      reason: "authorized-party-mismatch",
    });
  });

  it("asks nothing of the authorized party when the expectation names none, as for a client assertion", async () => {
    expect(await verify({ aud: ["tool", "extra"] }, { trustedAudiences: ["extra"] })).toMatchObject({ iss: issuer });
    expect(await verify({ azp: "anyone" })).toMatchObject({ azp: "anyone" });
  });

  it("verifies only with the algorithms the expectation names, RS256 among the six by default", async () => {
    await expect(verify({}, { algorithms: ["ES256"] })).rejects.toMatchObject({ reason: "algorithm-unsupported" });
    expect(await verify({}, { algorithms: ["RS256", "ES256"] })).toMatchObject({ iss: issuer });
  });
});

describe("unverifiedClaims", () => {
  const encode = (text: string) => Buffer.from(text).toString("base64url");
  const token = (payload: string) => `${encode("{}")}.${encode(payload)}.${encode("s")}`;

  it("reads the payload of a token, and refuses one of more JSON tokens than the limit before it parses it", () => {
    expect(unverifiedClaims(token('{"a":[1,2]}'))).toEqual({ a: [1, 2] });
    // `{"a":[1,2]}` has 9 tokens: { "a" : [ 1 , 2 ] }.
    expect(unverifiedClaims(token('{"a":[1,2]}'), 9)).toEqual({ a: [1, 2] });
    expect(() => unverifiedClaims(token('{"a":[1,2]}'), 8)).toThrow(
      expect.objectContaining({ reason: "token-malformed" }),
    );
  });

  it("refuses a payload that is not a JSON object in UTF-8", () => {
    for (const payload of ["[1]", "5", "null", "{", "", "not json"]) {
      expect(() => unverifiedClaims(token(payload)), payload).toThrow(
        expect.objectContaining({ reason: "token-malformed" }),
      );
    }
    const invalidUtf8 = `${encode("{}")}.${Buffer.from([0x7b, 0xff, 0x7d]).toString("base64url")}.${encode("s")}`;
    expect(() => unverifiedClaims(invalidUtf8)).toThrow(expect.objectContaining({ reason: "token-malformed" }));
  });

  it("reads a claim named __proto__ as data", () => {
    expect(Object.keys(unverifiedClaims(token('{"__proto__":{"x":1}}')))).toEqual(["__proto__"]);
  });
});

describe("renderPage", () => {
  it("answers a page with one script that no browser caches, shares a referrer or sniffs, and a policy that names the script", async () => {
    const page = await renderPage({
      body: "<p>Body</p>\n",
      script: "alert(1)",
      formAction: "'self'",
      frameAncestors: "https://lms.example.edu",
    });
    expect(page.status).toBe(200);
    expect(page.headers).toEqual({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": await pagePolicy("alert(1)", "'self'", "https://lms.example.edu"),
    });
    expect(page.body).toBe(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LTI launch</title>
</head>
<body>
<p>Body</p>
<script>alert(1)</script>
</body>
</html>
`);
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
