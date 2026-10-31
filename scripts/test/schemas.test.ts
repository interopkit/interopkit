import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { downloadSchemas, loadList, mapConcurrently, requireSchemas, schemaDirectory, sha256 } from "../schemas.ts";

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "interopkit-schemas-"));
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("the list", () => {
  it("pins every file to an https address, a file name and a SHA-256", () => {
    for (const { url, file, sha256: hash } of loadList(join(import.meta.dirname, "../.."))) {
      expect(url.startsWith("https://")).toBe(true);
      expect(url.endsWith(`/${file}`)).toBe(true);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("sha256", () => {
  it("hashes bytes as lowercase hexadecimal", () => {
    expect(sha256(new TextEncoder().encode("a"))).toBe(
      "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    );
  });
});

describe("mapConcurrently", () => {
  it("returns the results in the order of the items, however the runs finish", async () => {
    const results = await mapConcurrently([5, 4, 3, 2, 1, 0], async (item) => {
      await Promise.resolve();
      return item * 2;
    });
    expect(results).toStrictEqual([10, 8, 6, 4, 2, 0]);
  });
});

describe("downloadSchemas", () => {
  const A = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";

  /** A root with a list of one file, and a `fetch` that answers every address with the given text. */
  function setUp(name: string, hash: string, answer: string): { readonly root: string; readonly requests: string[] } {
    const root = join(directory, name);
    mkdirSync(join(root, "scripts"), { recursive: true });
    const list = [{ url: "https://spec.example/ctx/a.json", file: "a.json", sha256: hash }];
    writeFileSync(join(root, "scripts/schemas.lock.json"), JSON.stringify(list));
    const requests: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      requests.push(url);
      return Promise.resolve(new Response(answer));
    });
    return { root, requests };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads nothing when the list is empty", async () => {
    const root = join(directory, "empty");
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/schemas.lock.json"), "[]");
    expect(await downloadSchemas(root)).toStrictEqual([]);
  });

  it("writes a file whose bytes have the pinned hash, and downloads it only once", async () => {
    const { root, requests } = setUp("pinned", A, "a");
    expect(await downloadSchemas(root)).toStrictEqual(["a.json"]);
    expect(readFileSync(join(schemaDirectory(root), "a.json"), "utf8")).toBe("a");
    expect(await downloadSchemas(root)).toStrictEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("writes nothing and names both hashes when the bytes differ from the pinned ones", async () => {
    const { root } = setUp("changed", A, "b");
    await expect(downloadSchemas(root)).rejects.toThrow(/has the SHA-256 3e23e816.*, not the pinned ca978112/s);
    expect(existsSync(join(schemaDirectory(root), "a.json"))).toBe(false);
  });
});

describe("requireSchemas", () => {
  it("returns the schema directory below the root when it exists", () => {
    mkdirSync(join(directory, ".cache/schemas"), { recursive: true });
    expect(requireSchemas(directory)).toBe(join(directory, ".cache/schemas"));
  });

  it("says how to download the schemas when the directory is missing", () => {
    const root = join(directory, "none");
    expect(() => requireSchemas(root)).toThrow(
      `The schemas are not downloaded to ${schemaDirectory(root)}: run pnpm schemas first.`,
    );
  });
});
