import { describe, expect, it } from "vitest";
import { COMPACT_JWS, isCompactJws } from "../src/compact-jws.js";

describe("the form of a compact JWS", () => {
  it.each([
    ["three parts of base64url characters", "eyJhbGciOiJSUzI1NiJ9.e30.c2ln", true, true],
    ["a detached payload", "eyJhbGciOiJSUzI1NiJ9..c2ln", true, false],
    ["two parts", "eyJhbGciOiJSUzI1NiJ9.e30", false, false],
    ["four parts", "a.b.c.d", false, false],
    ["an empty header", ".e30.c2ln", false, false],
    ["an empty signature", "eyJhbGciOiJSUzI1NiJ9.e30.", false, false],
    ["padding", "eyJhbGciOiJSUzI1NiJ9.e30=.c2ln", false, false],
    ["the alphabet of plain base64", "eyJhbGciOiJSUzI1NiJ9.e3+/.c2ln", false, false],
    ["a line break at the end", "eyJhbGciOiJSUzI1NiJ9.e30.c2ln\n", false, false],
  ])(
    "with %s is a form that a schema accepts: %s, and a JWS that carries its payload: %s",
    (_name, text, form, carries) => {
      expect(COMPACT_JWS.test(text)).toBe(form);
      expect(isCompactJws(text)).toBe(carries);
    },
  );
});
