import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CorpusSource, download, fetchSource, loadLock, selectFiles, sha256, withRetries } from "../corpus.ts";

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "interopkit-corpus-"));
  mkdirSync(join(directory, "items/deep"), { recursive: true });
  mkdirSync(join(directory, "other"));
  writeFileSync(join(directory, "items/a.xml"), "a");
  writeFileSync(join(directory, "items/deep/b.xml"), "b");
  writeFileSync(join(directory, "items/.DS_Store"), "junk");
  writeFileSync(join(directory, "other/c.xml"), "c");
  writeFileSync(join(directory, "root.xml"), "r");
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const A = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";

describe("sha256", () => {
  it("hashes the bytes of a file", () => {
    expect(sha256(join(directory, "items/a.xml"))).toBe(A);
  });
});

describe("selectFiles", () => {
  it("returns the files under the included directories and the included files, sorted, without editor leftovers", () => {
    expect(selectFiles(directory, ["items/", "root.xml"])).toEqual(["items/a.xml", "items/deep/b.xml", "root.xml"]);
  });
});

describe("fetchSource", () => {
  const source: CorpusSource = {
    repository: "owner/repository",
    commit: "0".repeat(40),
    sha256: A,
    include: ["items/"],
  };

  it("downloads nothing when the directory of the source holds the stamp of the pinned archive", async () => {
    mkdirSync(join(directory, "stamped"));
    writeFileSync(join(directory, "stamped", ".archive-sha256"), A);
    expect(await fetchSource(directory, "stamped", source)).toBe("current");
  });
});

describe("the lock", () => {
  it("pins every source to a commit and to the SHA-256 of its archive", () => {
    const lock = loadLock(join(import.meta.dirname, "../.."));
    for (const source of Object.values(lock)) {
      expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.include.length).toBeGreaterThan(0);
    }
  });
});

describe("download", () => {
  it("aborts a download that stalls, and tries a failed one again a bounded number of times", async () => {
    const { createServer } = await import("node:http");
    let requests = 0;
    const server = createServer((_, response) => {
      requests += 1;
      response.writeHead(200);
      response.write("a");
      // The rest never comes: the connection stays open with no byte.
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/archive`;
    try {
      const file = join(directory, "stalled");
      await expect(withRetries(() => download(url, file, 100), 2, 1)).rejects.toThrow("No byte");
      expect(requests).toBe(2);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("returns what a download gives once it succeeds", async () => {
    let tries = 0;
    expect(
      await withRetries(
        async () => {
          tries += 1;
          if (tries < 2) throw new Error("Reset.");
          return "done";
        },
        3,
        1,
      ),
    ).toBe("done");
  });
});
