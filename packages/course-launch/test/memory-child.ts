import { READINGS, type Reading } from "./memory-readings.js";

// The process of one reading of `readInProcess` in memory.ts: it makes the input, reads it, and writes on its output how far
// the reading raised the peak resident memory of the process and what the reading returned or threw.
const [name = "", file] = process.argv.slice(2);
const reading: Reading | undefined = Object.hasOwn(READINGS, name)
  ? READINGS[name as keyof typeof READINGS]
  : undefined;
if (reading === undefined) throw new Error(`No reading is named ${JSON.stringify(name)}.`);
const input = await reading.input(file);
const before = process.resourceUsage().maxRSS * 1024;
const outcome = await reading.read(input as never);
const rise = process.resourceUsage().maxRSS * 1024 - before;
process.stdout.write(JSON.stringify({ rise, outcome }));
