import { resolve } from "node:path";
import { playwright } from "@vitest/browser-playwright";
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

/** The engines that run, from `BROWSERS` as a comma-separated list: `check:rules` runs one, and CI runs all three. */
const ENGINES = (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",");

/**
 * The engines of the browser tests. Vitest names the instances, so each project has its own. Firefox runs one file at a
 * time: the mouse of a page can reach another page of the same Firefox that runs at once.
 */
const browser = () => ({
  enabled: true,
  headless: true,
  provider: playwright(),
  instances: [
    { browser: "chromium" as const },
    { browser: "firefox" as const, fileParallelism: false },
    { browser: "webkit" as const },
  ].filter(({ browser: engine }) => ENGINES.includes(engine)),
});

/** The Node tests of a package, which run against the sources of the packages it depends on. */
const nodeProject = (name: string): TestProjectInlineConfiguration => ({
  resolve: { alias: SOURCES },
  test: {
    name,
    include: [`packages/${name}/test/**/*.test.ts`],
    exclude: ["**/*.browser.test.ts", "**/*.corpus.test.ts", "**/spec-examples.test.ts", "**/*.spec.test.ts"],
    testTimeout: HANG_LIMIT,
  },
});

// biome-ignore lint/style/noDefaultExport: Vitest reads its configuration from the default export.
export default defineConfig({
  test: {
    projects: [
      nodeProject("core"),
      nodeProject("competency-frameworks"),
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
        // The tests that read the schemas of CASE that `pnpm schemas` downloads, and compare the readers with them.
        resolve: { alias: SOURCES },
        test: {
          name: "competency-frameworks-corpus",
          include: ["packages/competency-frameworks/test/**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The examples are packages of their own, and a test of each runs its scenario against the sources.
        resolve: { alias: SOURCES },
        test: {
          name: "example-tool-integration",
          include: ["examples/tool-integration/test/**/*.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The same for the sensor.
        resolve: { alias: SOURCES },
        test: {
          name: "example-learning-analytics",
          include: ["examples/learning-analytics/test/**/*.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      nodeProject("tool-integration"),
      {
        // The pages of the client-side login, which run in the engines of the browsers.
        resolve: { alias: SOURCES },
        test: {
          name: "tool-integration-browser",
          include: ["packages/tool-integration/test/**/*.browser.test.ts"],
          // Starts the servers that the posted form reaches.
          globalSetup: ["packages/tool-integration/test/fixtures/servers-setup.ts"],
          browser: browser(),
        },
      },
      {
        // The examples of the CASE implementation guide: `pnpm spec-examples` downloads them.
        resolve: { alias: SOURCES },
        test: {
          name: "competency-frameworks-spec",
          include: ["packages/competency-frameworks/test/**/*.spec.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The examples of the specifications: `pnpm spec-examples` downloads them.
        resolve: { alias: SOURCES },
        test: {
          name: "tool-integration-spec",
          include: ["packages/tool-integration/test/spec-examples.test.ts"],
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
        "packages/competency-frameworks/src/**": { statements: 100, branches: 95, functions: 100, lines: 100 },
        "packages/learning-analytics/src/**": { statements: 100, branches: 95, functions: 100, lines: 100 },
        "packages/tool-integration/src/**": { statements: 98, branches: 95, functions: 100, lines: 99 },
      },
    },
  },
});
