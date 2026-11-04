import { type Reading, refusal } from "../../../scripts/peak-memory-child.js";
import { readForm, readJson } from "../src/http/index.js";
import { requestService } from "../src/index.js";

const MIB = 1024 * 1024;

/** The default limits of `readJson`: its bytes and its tokens. */
const JSON_BYTES = 1_048_576;
const JSON_TOKENS = 1_000_000;
/** The tokens of an empty object in a list: its two braces and a comma. */
const TOKENS_PER_OBJECT = 3;

/** The limit of a call to a service here, and the chunks of the answer. */
const SERVICE_LIMIT = MIB;
const CHUNK_BYTES = 65_536;
/** The most that the service sends before it ends the answer, so that a call without its limit ends and does not fill the memory. */
const SERVICE_CEILING = 64 * MIB;

/** The bytes of the form: ten times the default limit of a JSON body, which a host may allow a form. */
const FORM_BYTES = 10 * MIB;

/** The readings of the package, by name. */
export const READINGS = {
  /** An answer without end, read to a limit of 1 MiB: the call reads no more than the limit and cancels the rest. */
  serviceEndless: {
    input: () => undefined,
    read: async () => {
      let sent = 0;
      let cancelled = false;
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += CHUNK_BYTES;
          if (sent > SERVICE_CEILING) controller.close();
          else controller.enqueue(new Uint8Array(CHUNK_BYTES).fill(0x61));
        },
        cancel() {
          cancelled = true;
        },
      });
      const fetch = async () => new Response(endless, { status: 200 });
      const failure = await refusal(() =>
        requestService(
          { fetch, timeoutMs: 60_000 },
          "The service",
          "https://service.example/",
          { method: "GET", headers: {} },
          { maxBytes: SERVICE_LIMIT },
        ),
      );
      const reading = sent <= SERVICE_LIMIT + 2 * CHUNK_BYTES ? "read to the limit" : "read past the limit";
      return `${failure.split(":")[0]}, ${reading}, ${cancelled ? "cancelled" : "not cancelled"}`;
    },
  },
  /** A form of 10 MiB of one value of `+`, which is a space. */
  formPluses: {
    input: () => new TextEncoder().encode(`a=${"+".repeat(FORM_BYTES - 2)}`),
    read: (body: Uint8Array) => {
      const form = readForm({
        method: "POST",
        url: "https://provider.example/",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      return `a value of ${form.get("a")?.length} characters`;
    },
  },
  /** A body at the size limit that holds as many empty objects as the default limit of tokens leaves room for. */
  jsonObjects: {
    input: () => {
      const count = Math.floor((JSON_TOKENS - 2) / TOKENS_PER_OBJECT);
      const body = new TextEncoder().encode(`[${new Array(count).fill("{}").join(",")}]`);
      if (body.byteLength > JSON_BYTES) throw new Error("The body is over the default limit of bytes.");
      return body;
    },
    read: (body: Uint8Array) => {
      const read = readJson({ method: "POST", url: "https://provider.example/", headers: {}, body });
      return `a list of ${Array.isArray(read) ? read.length : "no"} objects`;
    },
  },
} satisfies Record<string, Reading>;
