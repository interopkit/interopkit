// biome-ignore-all lint/style/useNamingConvention: the names of the form parameters are those of LTI.

import { base64url } from "jose";
import { describe, expect, it } from "vitest";
import { ltiLaunch } from "../src/tool/index.js";
import { formPost } from "./fake-platform.js";
import { cookieLogin, setup } from "./tool-setup.js";

const MIB = 1024 * 1024;
/** The bytes that a launch may raise the peak of the process by: decoding the form of 64 MiB below would take more. */
const BUDGET = 32 * MIB;
/** The most bytes of the form of a launch by default. */
const MAX_FORM_BYTES = 65_536;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one function.
describe("the peak memory of a launch", () => {
  it("stays within the budget for a form at the limit whose token is one array of small objects, and for a form far above it", async ({
    annotate,
  }) => {
    const ctx = setup();
    const { auth, cookie } = await cookieLogin(ctx);
    const [header = "", , signature = ""] = auth.idToken.split(".");
    const room = MAX_FORM_BYTES - formPost({ id_token: `${header}..${signature}`, state: auth.state }).body.length;
    // Each `{},` is three bytes of JSON and four of base64url, so the payload fills the form to its last byte.
    const objects = Math.floor((room * 3) / 4 / 3) - 1;
    const payload = base64url.encode(`[${"{},".repeat(objects)}{}]`);
    const atLimit = formPost({ id_token: `${header}.${payload}.${signature}`, state: auth.state }, { cookie });
    expect(atLimit.body.byteLength).toBeLessThanOrEqual(MAX_FORM_BYTES);
    expect(atLimit.body.byteLength).toBeGreaterThan(MAX_FORM_BYTES - 8);
    const huge = formPost({ id_token: "a".repeat(64 * MIB), state: auth.state }, { cookie });
    const before = peak();
    await expect(ltiLaunch(atLimit, ctx.options)).rejects.toMatchObject({ reason: "token-malformed" });
    await expect(ltiLaunch(huge, ctx.options)).rejects.toMatchObject({ reason: "form-too-large" });
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
