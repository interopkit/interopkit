import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { type Reading, refusal } from "../../../scripts/peak-memory-child.js";
import { startAuSession } from "../src/au/index.js";
import { readCourseStructure, readLaunchUrl, validateCourseStructure } from "../src/index.js";
import { readCoursePackage } from "../src/package/index.js";
import { launchFor } from "./au-host.js";
import { structure, TEXTS } from "./course-xml.js";
import { AU1, testHost } from "./lms-host.js";
import { launchUnit, register, sendStatement, unitStatement } from "./lms-session.js";

/** A mebibyte, in bytes. */
const MIB = 1024 * 1024;

/** The bytes of an archive of `validation/cmi5_archives.py`, gunzipped when its name says so. */
function archive(name: string): Uint8Array {
  const bytes = readFileSync(new URL(`./fixtures/archives/${name}`, import.meta.url));
  return name.endsWith(".gz") ? gunzipSync(bytes) : bytes;
}

/** A `fetch` of a unit that answers the requests whose URL holds `part` with `body`, and the others from its LMS. */
async function answering(part: string, body: string) {
  const launch = await launchFor();
  const headers = { "content-type": "application/json", etag: '"1"', "last-modified": "Thu, 15 Jan 2026 10:00:00 GMT" };
  return {
    url: launch.url,
    fetch: async (url: string, init: Parameters<typeof launch.fetch>[1]) =>
      url.includes(part) ? new Response(body, { headers }) : launch.fetch(url, init),
  };
}

/** Starts a unit with a `fetch` that answers the requests whose URL holds `part` with `body`, which is to refuse what it reads. */
async function startRefused(part: string, body: string): Promise<string> {
  const launch = await answering(part, body);
  return await refusal(() => startAuSession(launch.url, { fetch: launch.fetch }));
}

/** The readings, by name: the readers of course structures, packages and launch URLs, the LMS and the runtime of a unit. */
export const READINGS = {
  /** A structure of almost a million texts, at the limit of elements: the model of the most texts it holds. */
  structureTexts: {
    input: () =>
      structure(undefined, { courseInner: TEXTS.replace("<title>", `<title>${"<langstring/>".repeat(999_900)}`) }),
    read: (xml: string) => `${readCourseStructure(xml).course.title.length} texts`,
  },
  /** 16 MiB of empty elements, refused at the limit of elements. */
  structureElements: {
    input: () => {
      const empties = "<langstring/>".repeat(Math.floor((16 * MIB - 1_000) / 13));
      return structure(undefined, { courseInner: TEXTS.replace("<title>", `<title>${empties}`) });
    },
    read: (xml: string) => refusal(() => readCourseStructure(xml)),
  },
  /** Blocks nested to 16 MiB, refused at the limit of depth. */
  structureDepth: {
    input: () => {
      const opening = `<block id="https://example.org/b">${TEXTS}`;
      const depth = Math.floor((16 * MIB - 2_000) / (opening.length + 8));
      return structure(`${opening.repeat(depth)}${"</block>".repeat(depth)}`);
    },
    read: (xml: string) => refusal(() => readCourseStructure(xml)),
  },
  /** One langstring of almost 16 MiB. */
  structureText: {
    input: () =>
      structure(undefined, { courseInner: TEXTS.replace(">T<", `>${"a ".repeat((16 * MIB - 2_000) / 2)}<`) }),
    read: (xml: string) => `a text of ${readCourseStructure(xml).course.title[0]?.text.length} characters`,
  },
  /** A million wrong values, whose findings stop at the limit. */
  structureFindings: {
    input: () => structure(undefined, { courseInner: `${TEXTS}${'<x xmlns=""/>'.repeat(999_000)}` }),
    read: (xml: string) => {
      const findings = validateCourseStructure(xml);
      return `${findings.length} findings, the last ${findings.at(-1)?.rule}`;
    },
  },
  /** A package of 100,000 entries, the limit. */
  packageEntries: {
    input: () => archive("entries-limit.zip.gz"),
    read: async (bytes: Uint8Array) => `${(await readCoursePackage(bytes)).paths.length} files`,
  },
  /** A package whose central directory is at its limit of 16 MiB. */
  packageDirectory: {
    input: () => archive("directory-limit.zip.gz"),
    read: async (bytes: Uint8Array) => `${(await readCoursePackage(bytes)).paths.length} files`,
  },
  /** A package whose cmi5.xml inflates to 64 MiB and says it has 64 bytes. */
  packageInflate: {
    input: () => archive("lying-bomb.zip"),
    read: (bytes: Uint8Array) => refusal(() => readCoursePackage(bytes)),
  },
  /** A launch URL at its limit, with an actor of the most tokens it holds. */
  launchUrl: {
    input: () => {
      const base =
        "https://content.example.org/au/1/index.html?endpoint=https://lms.example.org/xapi/&fetch=https://lms.example.org/f" +
        "&registration=1b0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d&activityId=https://lms.example.org/au/1&actor=";
      const tokens = Math.floor((65_536 - base.length - 2) / 2);
      return `${base}[${"0,".repeat(tokens - 1)}0]`;
    },
    read: (url: string) => refusal(() => readLaunchUrl(url)),
  },
  /** A batch of 1,000 statements of a unit, near the 10 MiB of a request, which the LMS judges and takes. */
  lmsBatch: {
    input: () => undefined,
    read: async () => {
      const host = testHost();
      const launched = await launchUnit(host, { registration: (await register(host)).id, au: AU1 });
      await sendStatement(host, launched, unitStatement(launched, "initialized"));
      const pad = "x".repeat(9000);
      const batch = Array.from({ length: 1000 }, () => ({
        ...unitStatement(launched, "experienced"),
        result: { response: pad },
      }));
      return `status ${(await host.xapi("POST", "statements", { authorization: launched.authorization, body: batch })).status}`;
    },
  },
  /** A preferences document of 10 MiB that a unit writes, refused after its limit of 4,096 bytes. */
  lmsPreferences: {
    input: () => new Uint8Array(10 * MIB - 1024).fill(0x20),
    read: async (body: Uint8Array) => {
      const host = testHost();
      const launched = await launchUnit(host, { registration: (await register(host)).id, au: AU1 });
      const query = new URLSearchParams({ profileId: "cmi5LearnerPreferences", agent: JSON.stringify(launched.actor) });
      const headers = { "content-type": "application/json" };
      const put = await host.xapi("PUT", `agents/profile?${query}`, {
        authorization: launched.authorization,
        body,
        headers,
      });
      return `status ${put.status}`;
    },
  },
  /** The answer of the fetch URL at its limit, with the most tokens it holds. */
  unitFetch: {
    input: () => `[${"0,".repeat(32_766)}0]`,
    read: (body: string) => startRefused("/fetch", body),
  },
  /** Launch data at their limit, with the most values they hold. */
  unitLaunchData: {
    input: () =>
      JSON.stringify({ contextTemplate: { extensions: { "https://x.example.org/e": Array(250_000).fill(0) } } }),
    read: (body: string) => startRefused("stateId=LMS.LaunchData", body),
  },
  /** A preferences document of 1 MiB, over its limit of 4,096 bytes. */
  unitPreferences: {
    input: () => `{"languagePreference":"en-US","audioPreference":"on","pad":"${"x".repeat(MIB - 100)}"}`,
    read: (body: string) => startRefused("profileId=cmi5LearnerPreferences", body),
  },
  /** An answer of more than 1 MiB to the query of what the registration held. */
  unitPrior: {
    input: () => JSON.stringify({ statements: [], more: "", pad: "x".repeat(MIB + 1) }),
    read: (body: string) => startRefused("/statements?", body),
  },
} satisfies Record<string, Reading>;
