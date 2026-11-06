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

  it("run the browser jobs in the image of the Playwright that the lock file pins, which holds its browsers", () => {
    // The lock file has two documents: the second holds the importers, and its root importer the version of Playwright.
    const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
    const root =
      /\nimporters:\n\n {2}\.:\n([\s\S]*?)\n {2}\S/u.exec(lock.slice(lock.lastIndexOf("\n---\n")))?.[1] ?? "";
    const pinned = /\n {6}playwright:\n {8}specifier: \S+\n {8}version: (\S+)\n/u.exec(root)?.[1];
    expect(pinned).toMatch(EXACT);
    // The browser tests, CATAPULT's LMS suite and the mutation rules.
    const images = [".github/workflows/ci.yml", ".github/workflows/rules.yml"].flatMap((file) =>
      [...readFileSync(join(ROOT, file), "utf8").matchAll(/playwright:v([^\s-]+)-noble/gu)].map(
        ([, version]) => `${file} ${version}`,
      ),
    );
    expect(images.length).toBeGreaterThanOrEqual(3);
    expect(images.filter((image) => !image.endsWith(` ${pinned}`))).toStrictEqual([]);
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
