import { runAll } from "./scenarios.ts";

// Node.js, Deno and Bun pass the address of the server of the check as the last argument, and read the results as JSON.
const base = process.argv.at(-1) ?? "";
console.log(JSON.stringify(await runAll(base)));
