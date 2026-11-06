import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/** The licenses that a runtime dependency of the family may have: MIT, Apache-2.0, BSD, ISC. */
export const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
]);

/**
 * The packages whose license is not on the list and that the owner approved on 2026-11-01, by name and the expression the
 * report gives. `did-context` carries JSON-LD data files under the W3C Software and Document License, and `lru-cache` is under
 * BlueOak-1.0.0; AGENTS.md records each with its reason.
 */
export const APPROVED_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["did-context", "BSD"],
  ["lru-cache", "BlueOak-1.0.0"],
]);

/** One package of the report of `pnpm licenses list --json`. */
interface Entry {
  readonly name: string;
  readonly versions: readonly string[];
}

/** The report of `pnpm licenses list --json`: the packages by the license expression they declare. */
export type Report = Readonly<Record<string, readonly Entry[]>>;

/** Whether a license expression is allowed: one alternative of an `OR`, and every part of an `AND`, must be on the list. */
export function isAllowed(expression: string): boolean {
  return expression
    .replace(/[()]/g, "")
    .split(/\s+OR\s+/)
    .some((alternative) => alternative.split(/\s+AND\s+/).every((license) => ALLOWED_LICENSES.has(license.trim())));
}

/** Returns the packages whose license is not allowed and not approved, as `name@version (license)`. */
export function disallowed(report: Report): string[] {
  return Object.entries(report)
    .filter(([expression]) => !isAllowed(expression))
    .flatMap(([expression, entries]) =>
      entries
        .filter((entry) => APPROVED_EXCEPTIONS.get(entry.name) !== expression)
        .flatMap((entry) => entry.versions.map((version) => `${entry.name}@${version} (${expression})`)),
    );
}

/** Reads the licenses of the production dependencies of every package and returns the exit code. */
function main(): number {
  const run = spawnSync("pnpm", ["licenses", "list", "--prod", "--recursive", "--json"], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`pnpm licenses failed: ${run.stderr}`);
  const found = disallowed(JSON.parse(run.stdout));
  for (const line of found) console.error(`${line} has a license that is not allowed.`);
  console.log(
    found.length === 0
      ? "Every dependency has an allowed license."
      : `${found.length} dependencies break the license rule.`,
  );
  return found.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
