import { type Fetch, requestService } from "@interopkit/core";
import { expect, test } from "vitest";
import { alternate, expectRatioWithin } from "./budgets.js";

/** The bytes of the answer: the limit of a status list credential, the largest answer that the packages read by default. */
const ANSWER_BYTES = 1_048_576;
/** The bytes of each chunk of the answer, as a network splits it. */
const CHUNK_BYTES = 16_384;
const body = new Uint8Array(ANSWER_BYTES).fill(0x61);

/** An answer whose body arrives in chunks. */
function answer(): Response {
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= body.length) {
        controller.close();
        return;
      }
      controller.enqueue(body.slice(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
}

const fetch: Fetch = async () => answer();
const service = { fetch, timeoutMs: 10_000 };

test("reads an answer of 1 MiB in chunks near Response.arrayBuffer", async ({ annotate, bench }) => {
  const read = () =>
    requestService(
      service,
      "The service",
      "https://service.example/",
      { method: "GET", headers: {} },
      {
        maxBytes: ANSWER_BYTES,
      },
    );
  expect((await read()).body).toStrictEqual(body);
  const sides = await alternate(bench, "requestService", read, {
    name: "fetch and Response.arrayBuffer",
    run: async () => new Uint8Array(await (await fetch("https://service.example/", {} as never)).arrayBuffer()),
  });
  await expectRatioWithin(annotate, "requestService", "Response.arrayBuffer", sides);
});
