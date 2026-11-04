import { readFileSync, writeFileSync } from "node:fs";
import { deserialize, serialize } from "node:v8";

/**
 * A reading of untrusted input on its worst input within the limits: what it reads, and the reading, which says what it returned
 * or what it threw. The input is made in a process of its own, without a bound on its heap, and handed on through `node:v8`'s
 * serialization, so it is plain data, text or bytes, and the cost of making it does not count against the heap of the reading.
 * What cannot be serialized, such as the functions a host passes in, belongs to the reading.
 */
export interface Reading {
  readonly input: () => unknown;
  readonly read: (input: never) => Promise<string> | string;
}

/** What a reading threw, by the class and the sentence of the error. */
function thrown(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  throw error;
}

/** Runs a reading that is to throw, and says what it threw. */
export async function refusal(read: () => unknown): Promise<string> {
  try {
    await read();
  } catch (error) {
    return thrown(error);
  }
  return "no error";
}

/**
 * The process of one reading of `peak-memory.ts`. `make <name> <file>` writes the input of the reading to the file, `read <name>
 * <file>` reads the input from the file, reads it, and writes on the output how far the reading raised the peak resident memory
 * of the process and what the reading returned or threw, and `names` lists the readings.
 *
 * @param readings - The readings of a package, by name.
 */
export async function runReading(readings: Readonly<Record<string, Reading>>): Promise<void> {
  const [mode = "", name = "", file = ""] = process.argv.slice(2);
  if (mode === "names") {
    process.stdout.write(JSON.stringify(Object.keys(readings)));
    return;
  }
  const reading = Object.hasOwn(readings, name) ? readings[name] : undefined;
  if (reading === undefined) throw new Error(`No reading is named ${JSON.stringify(name)}.`);
  if (mode === "make") {
    writeFileSync(file, serialize(await reading.input()));
    return;
  }
  const input = deserialize(readFileSync(file));
  const before = process.resourceUsage().maxRSS * 1024;
  const outcome = await reading.read(input as never);
  const rise = process.resourceUsage().maxRSS * 1024 - before;
  process.stdout.write(JSON.stringify({ rise, outcome }));
}
