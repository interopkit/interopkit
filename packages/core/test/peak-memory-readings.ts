import { type Reading, refusal } from "../../../scripts/peak-memory-child.js";
import { readForm, readJson } from "../src/http/index.js";
import { createJwksCache, type Fetch, requestService } from "../src/index.js";

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

/** The most bytes of the answer of a key set, and the most keys of a set. */
const KEY_SET_BYTES = 65_536;
const KEY_SET_KEYS = 100;
const URL_OF_SET = "https://lms.example.edu/jwks";

/** An answer of 64 MiB of keys, which the network delivers a chunk at a time, as the reading asks for them. */
function hugeAnswer(): Response {
  const encoder = new TextEncoder();
  const chunk = encoder.encode("{},".repeat(21_845));
  let chunks = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        chunks += 1;
        if (chunks === 1) controller.enqueue(encoder.encode('{"keys":['));
        else if (chunks <= 1024) controller.enqueue(chunk);
        else controller.close();
      },
    }),
  );
}

/** Resolves a key from the set at the URL, with a cache that keeps nothing between the readings. */
function resolve(body: string | (() => Response)) {
  const fetch: Fetch = async () => (typeof body === "string" ? new Response(body) : body());
  const cache = createJwksCache({ fetch, clock: { now: () => 1_700_000_000_000 } });
  return cache.keySet(URL_OF_SET)({ alg: "RS256", kid: "k" }, { payload: "", signature: "" });
}

/** What the rejection of a read of a key set is: the class of the error, and its code where it has one. */
async function rejection(read: () => unknown): Promise<string> {
  const text = await refusal(read);
  return text.includes("above the limit of 100")
    ? "DataError above the limit of 100 keys"
    : (text.split(":")[0] ?? text);
}

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
  /** The key sets at the limits of bytes and keys, one nested too deep to copy, and one far above the limit. */
  keySets: {
    input: () => {
      // Each `{},` is one key of three bytes: the most keys that an answer at the limit can hold, refused by their number.
      const keys = `{"keys":[${"{},".repeat(Math.floor((KEY_SET_BYTES - 12) / 3) - 1)}{}]}`;
      // The most keys that a set may have, each with a member that fills the answer to its limit.
      const filler = "a".repeat(Math.floor(KEY_SET_BYTES / KEY_SET_KEYS) - 12);
      const large = `{"keys":[${Array.from({ length: KEY_SET_KEYS }, () => `{"x":"${filler}"}`).join(",")}]}`;
      const nested = `{"keys":[{"x":${"[".repeat(32_000)}${"]".repeat(32_000)}}]}`;
      return { keys, large, nested };
    },
    read: async ({ keys, large, nested }: { keys: string; large: string; nested: string }) =>
      [
        await rejection(() => resolve(keys)),
        await rejection(() => resolve(large)),
        await rejection(() => resolve(nested)),
        await rejection(() => resolve(hugeAnswer)),
      ].join("; "),
  },
} satisfies Record<string, Reading>;
