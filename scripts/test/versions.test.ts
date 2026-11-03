import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");

/** An exact version, with a pre-release if it has one: no range and no tag. */
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/** A package that is not from the registry: one of the workspace. */
const LOCAL = /^workspace:/u;

/** The folders directly below a folder of the repository. */
const foldersIn = (folder: string): string[] =>
  readdirSync(join(ROOT, folder), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => join(folder, entry.name));

/** The folders of the workspace (`pnpm-workspace.yaml`), with the root. */
const WORKSPACE = [".", ...foldersIn("packages"), ...foldersIn("examples"), "compat"];

describe("the versions of the dependencies", () => {
  it("are exact in every package of the workspace, so that every machine and CI run builds the same output", () => {
    const loose: string[] = [];
    for (const folder of WORKSPACE) {
      const manifest: Record<string, Record<string, string> | undefined> = JSON.parse(
        readFileSync(join(ROOT, folder, "package.json"), "utf8"),
      );
      for (const field of ["dependencies", "devDependencies"]) {
        for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
          if (!(EXACT.test(spec) || LOCAL.test(spec))) loose.push(`${folder}: ${name} ${spec}`);
        }
      }
    }
    expect(loose).toStrictEqual([]);
  });

  it("find the packages of the workspace", () => {
    expect(WORKSPACE).toEqual(
      expect.arrayContaining([
        ".",
        "packages/core",
        "packages/achievement-credentials",
        "examples/course-launch",
        "compat",
      ]),
    );
  });
});
