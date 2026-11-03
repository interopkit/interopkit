import { writeFileSync } from "node:fs";

/** How long a download may go without a byte before it counts as stalled, in milliseconds. */
const STALL_MS = 30_000;
/** The tries of a download that fails or stalls, the first included. */
const DOWNLOAD_TRIES = 3;
/** The wait before a download is tried again, in milliseconds, doubled at each try. */
const RETRY_MS = 2000;

/** The statuses that a server answers when it may answer otherwise later: a timeout, too many requests, and its own faults. */
const PASSING_STATUSES: ReadonlySet<number> = new Set([408, 429]);

/** A download that the server answered with a status other than 2xx. */
export class DownloadStatusError extends Error {
  override name = "DownloadStatusError";
  readonly status: number;

  constructor(url: string, status: number) {
    super(`Downloading ${url} failed: HTTP ${status}.`);
    this.status = status;
  }
}

/** Tells whether a failed download may succeed when it is tried again: a network failure, a stall, or a passing status. */
function isPassing(error: unknown): boolean {
  return !(error instanceof DownloadStatusError) || error.status >= 500 || PASSING_STATUSES.has(error.status);
}

/** What a download may set. */
export interface DownloadOptions {
  /** The headers of the request. @defaultValue none */
  readonly headers?: Readonly<Record<string, string>>;
  /** How long the server may take to answer the request. @defaultValue 30,000 */
  readonly answerMs?: number;
  /** How long the body of the answer may go without a byte. @defaultValue 30,000 */
  readonly stallMs?: number;
  /** The tries, the first included. @defaultValue 3 */
  readonly tries?: number;
  /** The wait before the second try, doubled at each further one. @defaultValue 2,000 */
  readonly retryMs?: number;
}

/**
 * Runs a download again after a failure that may pass, up to `tries` times in all, waiting longer each time, and throws the
 * last failure. A status that will not change, such as 404, is thrown at once.
 */
export async function withRetries<T>(run: () => Promise<T>, tries = DOWNLOAD_TRIES, retryMs = RETRY_MS): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= tries || !isPassing(error)) throw error;
      console.error(`${error instanceof Error ? error.message : error} Trying again (${attempt + 1} of ${tries}).`);
      await new Promise((done) => setTimeout(done, retryMs * 2 ** (attempt - 1)));
    }
  }
}

/**
 * Requests an address and reads the body of its answer: it aborts when the server does not answer within `answerMs`, and when
 * the body brings no byte for `stallMs` once the answer began, so that a stalled connection fails fast instead of holding the
 * job. The clock of the body starts with the answer, so the time a request takes to reach the server never counts as a stall.
 * The body is read chunk by chunk from the stream of `fetch`, whose type is the same in every configuration of TypeScript that
 * reads this file.
 */
async function once(url: string, options: DownloadOptions): Promise<Uint8Array> {
  const answerMs = options.answerMs ?? STALL_MS;
  const stallMs = options.stallMs ?? STALL_MS;
  const controller = new AbortController();
  const stall = () => controller.abort(new Error(`No byte of ${url} arrived for ${stallMs} ms.`));
  let timer = setTimeout(() => controller.abort(new Error(`${url} did not answer in ${answerMs} ms.`)), answerMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { ...options.headers } });
    clearTimeout(timer);
    timer = setTimeout(stall, stallMs);
    if (!response.ok) throw new DownloadStatusError(url, response.status);
    const chunks: Uint8Array[] = [];
    const reader = response.body?.getReader();
    for (let chunk = await reader?.read(); chunk !== undefined && !chunk.done; chunk = await reader?.read()) {
      clearTimeout(timer);
      timer = setTimeout(stall, stallMs);
      chunks.push(chunk.value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    clearTimeout(timer);
  }
}

/** Downloads an address into memory, with the stall timeout and the retries, and returns its bytes. */
export function downloadBytes(url: string, options: DownloadOptions = {}): Promise<Uint8Array> {
  return withRetries(() => once(url, options), options.tries, options.retryMs);
}

/** Downloads an address as UTF-8 text, with the stall timeout and the retries. */
export async function downloadText(url: string, options: DownloadOptions = {}): Promise<string> {
  return new TextDecoder().decode(await downloadBytes(url, options));
}

/** Downloads an address to a file, with the stall timeout and the retries; the file is written once all of it arrived. */
export async function downloadFile(url: string, file: string, options: DownloadOptions = {}): Promise<void> {
  writeFileSync(file, await downloadBytes(url, options));
}
