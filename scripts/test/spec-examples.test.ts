import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  examplesDirectory,
  examplesHash,
  fetchSpecExamples,
  jsonBlocks,
  loadLock,
  readSpecExamples,
} from "../spec-examples.ts";

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "interopkit-spec-examples-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const PAGE = `<html><body>
<pre class="code">{ "a": "x &amp; y", "b": [1, 2] }</pre>
<pre><code>{ "c": &quot;<span>d</span>&quot; }</code></pre>
<pre>{ ... "ellipsis": 1 }</pre>
<pre>npm install</pre>
</body></html>`;

describe("jsonBlocks", () => {
  it("returns the JSON of the preformatted blocks in order, with entities decoded and tags removed", () => {
    expect(jsonBlocks(PAGE)).toStrictEqual([{ a: "x & y", b: [1, 2] }, { c: "d" }]);
  });

  it("skips a block that is not JSON, such as a fragment with an ellipsis or a command", () => {
    expect(jsonBlocks("<pre>{ ... }</pre><pre>ls</pre>")).toStrictEqual([]);
  });

  it("decodes numeric references", () => {
    expect(jsonBlocks("<pre>{ &#34;k&#x22;: &#x31; }</pre>")).toStrictEqual([{ k: 1 }]);
  });
});

describe("examplesHash", () => {
  it("is the SHA-256 of the examples as JSON, and changes when an example changes", () => {
    // printf '[{"a":1}]' | shasum -a 256
    expect(examplesHash([{ a: 1 }])).toBe("b713f6d2a989e907c58516a7c8bb487792c8785ddbf367b80dc774bf33b85a85");
    expect(examplesHash([{ a: 1 }])).not.toBe(examplesHash([{ a: 2 }]));
    expect(examplesHash([{ a: 1 }])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the lock", () => {
  it("pins every page to an https address, a file name and the hash of its examples", () => {
    const lock = loadLock(join(import.meta.dirname, "../.."));
    expect(lock.length).toBeGreaterThan(0);
    for (const { url, file, sha256 } of lock) {
      expect(url).toMatch(/^https:\/\/www\.(?:imsglobal\.org\/spec|w3\.org\/TR)\//u);
      expect(file).toMatch(/^[a-z0-9-]+\.json$/);
      expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("fetchSpecExamples", () => {
  /** A root with a lock of one page, and a `fetch` that answers with the given page. */
  function setUp(name: string, hash: string, page: string): string {
    const root = join(directory, name);
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(
      join(root, "scripts/spec-examples.lock.json"),
      JSON.stringify([{ url: "https://spec.example/page", file: "page.json", sha256: hash }]),
    );
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(page)));
    return root;
  }

  it("writes the examples of a page whose examples have the pinned hash, whatever else the page holds", async () => {
    const root = setUp("pinned", examplesHash(jsonBlocks(PAGE)), PAGE);
    await fetchSpecExamples(root);
    expect(JSON.parse(readFileSync(join(examplesDirectory(root), "page.json"), "utf8"))).toStrictEqual(
      jsonBlocks(PAGE),
    );
  });

  it("writes nothing and names both hashes when the examples differ from the pinned ones", async () => {
    const root = setUp("changed", "0".repeat(64), PAGE);
    await expect(fetchSpecExamples(root)).rejects.toThrow(/have the SHA-256 [0-9a-f]{64}, not the pinned 0{64}/);
  });
});

describe("readSpecExamples", () => {
  it("says how to download the examples when the directory is missing", () => {
    const root = join(directory, "none");
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/spec-examples.lock.json"), "[]");
    expect(() => readSpecExamples(root)).toThrow(
      `The specification examples are not downloaded to ${examplesDirectory(root)}: run pnpm spec-examples first.`,
    );
  });
});
