import { resolve } from "node:path";
import { defineConfig, type TestProjectInlineConfiguration } from "vitest/config";

/**
 * Resolves the packages of this repository and their subpaths to their sources, so that a test runs the code and not a
 * build. A subpath is a folder with an `index.ts`, except `checks` of `@interopkit/core`, which is a file.
 */
const SOURCES = [
  { find: /^@interopkit\/core\/checks$/, replacement: resolve(import.meta.dirname, "packages/core/src/checks.ts") },
  { find: /^@interopkit\/([^/]+)$/, replacement: resolve(import.meta.dirname, "packages/$1/src/index.ts") },
  { find: /^@interopkit\/([^/]+)\/(.+)$/, replacement: resolve(import.meta.dirname, "packages/$1/src/$2/index.ts") },
];

/**
 * The limit of a test in the projects whose tests do seconds of work on the CPU. It is there to catch a hang, and not to
 * judge speed: a host that runs many test runs at once takes tens of times as long as a quiet one.
 */
const HANG_LIMIT = 60_000;

/** The Node tests of a package, which run against the sources of the packages it depends on. */
const nodeProject = (name: string): TestProjectInlineConfiguration => ({
  resolve: { alias: SOURCES },
  test: {
    name,
    include: [`packages/${name}/test/**/*.test.ts`],
    exclude: ["**/*.browser.test.ts", "**/*.corpus.test.ts"],
    testTimeout: HANG_LIMIT,
  },
});

// biome-ignore lint/style/noDefaultExport: Vitest reads its configuration from the default export.
export default defineConfig({
  test: {
    projects: [
      nodeProject("core"),
      nodeProject("learning-analytics"),
      {
        // The tests that read the files `pnpm schemas` downloads. `pnpm test` leaves them out and `pnpm test:corpus` runs them.
        resolve: { alias: SOURCES },
        test: {
          name: "learning-analytics-corpus",
          include: ["packages/learning-analytics/test/**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The examples are packages of their own, and a test of each runs its scenario against the sources.
        resolve: { alias: SOURCES },
        test: {
          name: "example-learning-analytics",
          include: ["examples/learning-analytics/test/**/*.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        test: {
          name: "scripts",
          include: ["scripts/test/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      // One floor per package: a gap in the tests of a package fails its own floor and no other.
      thresholds: {
        "packages/core/src/**": { statements: 100, branches: 95, functions: 100, lines: 100 },
        "packages/learning-analytics/src/**": { statements: 100, branches: 95, functions: 100, lines: 100 },
      },
    },
  },
});
