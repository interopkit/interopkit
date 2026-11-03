import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DownloadStatusError, downloadBytes, downloadFile, downloadText, withRetries } from "../download.ts";

let server: Server;
let base = "";
let directory = "";
/** How many requests each path got. */
const requests = new Map<string, number>();

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "interopkit-download-"));
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    const count = (requests.get(path) ?? 0) + 1;
    requests.set(path, count);
    if (path === "/stall") {
      response.writeHead(200);
      // The answer and one byte, then nothing: the connection stays open. The clock of a stall starts with the answer, so the
      // time the request takes to arrive never counts, and each try reaches the server.
      response.write("a");
    } else if (path === "/silent") {
      // No answer at all: the connection stays open.
    } else if (path === "/flaky" && count === 1) {
      response.writeHead(503).end("busy");
    } else if (path === "/missing") {
      response.writeHead(404).end("no");
    } else if (path === "/reset" && count === 1) {
      request.socket.destroy();
    } else {
      response.writeHead(200, { "content-type": "text/plain" }).end(`body of ${path}, ${request.headers.accept ?? ""}`);
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("the downloads of the scripts", () => {
  it("aborts a download whose body stalls once the answer began, and tries it again a bounded number of times", async () => {
    await expect(downloadBytes(`${base}/stall`, { stallMs: 100, tries: 2, retryMs: 1 })).rejects.toThrow("No byte");
    expect(requests.get("/stall")).toBe(2);
  });

  it("aborts a request that the server does not answer in time", async () => {
    await expect(downloadBytes(`${base}/silent`, { answerMs: 100, tries: 1 })).rejects.toThrow("did not answer");
  });

  it("tries again after a status that may pass and a dropped connection, and returns what then arrives", async () => {
    expect(await downloadText(`${base}/flaky`, { retryMs: 1 })).toBe("body of /flaky, */*");
    expect(await downloadText(`${base}/reset`, { retryMs: 1, headers: { accept: "text/plain" } })).toBe(
      "body of /reset, text/plain",
    );
  });

  it("throws a status that will not change at once", async () => {
    await expect(downloadBytes(`${base}/missing`, { retryMs: 1 })).rejects.toThrow(DownloadStatusError);
    expect(requests.get("/missing")).toBe(1);
  });

  it("writes a download to a file", async () => {
    const file = join(directory, "file");
    await downloadFile(`${base}/file`, file, { retryMs: 1 });
    expect(readFileSync(file, "utf8")).toBe("body of /file, */*");
  });

  it("returns what a run gives once it succeeds, and throws the last failure after the tries", async () => {
    let tries = 0;
    const run = async () => {
      tries += 1;
      if (tries < 2) throw new Error("Reset.");
      return "done";
    };
    expect(await withRetries(run, 3, 1)).toBe("done");
    await expect(withRetries(() => Promise.reject(new Error("Down.")), 2, 1)).rejects.toThrow("Down.");
  });
});
