import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type TestProjectInlineConfiguration } from "vitest/config";

/**
 * Resolves the packages of this repository and their subpaths to their sources, so that a test runs the code and not a
 * build. A subpath is a folder with an `index.ts`, except `checks` of `@interopkit/core`, which is a file, and a path in an
 * example, which is a file of that example.
 */
const SOURCES = [
  // An example that builds on another reads its files by their path in that example's package.
  { find: /^@interopkit\/example-([^/]+)\/(.+)$/, replacement: resolve(import.meta.dirname, "examples/$1/$2") },
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
const nodeProject = (name: string, also: readonly string[] = []): TestProjectInlineConfiguration => ({
  resolve: { alias: SOURCES },
  test: {
    name,
    include: [`packages/${name}/test/**/*.test.ts`],
    exclude: ["**/*.browser.test.ts", "**/*.corpus.test.ts", "**/*.spec.test.ts", ...also],
    testTimeout: HANG_LIMIT,
  },
});

/** The least coverage of each measure, in percent. */
interface Floor {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

/** The floor of the modules of each package, which each module holds on its own and not in the average of its package. */
const PACKAGE_FLOORS: Readonly<Record<string, Floor>> = {
  core: { statements: 100, branches: 95, functions: 100, lines: 100 },
  "competency-frameworks": { statements: 100, branches: 95, functions: 100, lines: 100 },
  "achievement-credentials": { statements: 100, branches: 95, functions: 100, lines: 100 },
  "learning-analytics": { statements: 100, branches: 95, functions: 100, lines: 100 },
  "learning-records": { statements: 100, branches: 95, functions: 100, lines: 100 },
  "selective-disclosure": { statements: 100, branches: 95, functions: 100, lines: 100 },
  "course-launch": { statements: 100, branches: 95, functions: 100, lines: 100 },
  "tool-integration": { statements: 98, branches: 95, functions: 100, lines: 99 },
};

/**
 * The coverage floors, one for each module: a folder of a package's `src`, or a file beside them. The globs come from the
 * directory listing, so that a module is held as soon as it exists.
 */
const FLOORS: Record<string, Floor> = Object.fromEntries(
  Object.entries(PACKAGE_FLOORS).flatMap(([name, floor]) =>
    readdirSync(resolve(import.meta.dirname, "packages", name, "src"), { withFileTypes: true }).map((entry) => [
      `packages/${name}/src/${entry.isDirectory() ? `${entry.name}/**` : entry.name}`,
      floor,
    ]),
  ),
);

// biome-ignore lint/style/noDefaultExport: Vitest reads its configuration from the default export.
export default defineConfig({
  test: {
    projects: [
      nodeProject("core"),
      nodeProject("competency-frameworks"),
      nodeProject("achievement-credentials"),
      nodeProject("learning-records"),
      nodeProject("learning-analytics"),
      nodeProject("selective-disclosure"),
      nodeProject("course-launch"),
      {
        // The tests that read the files `pnpm schemas`, `pnpm corpus` and `pnpm caliper-tables` download. `pnpm test` leaves them
        // out and `pnpm test:corpus` runs them.
        resolve: { alias: SOURCES },
        test: {
          name: "learning-analytics-corpus",
          include: ["packages/learning-analytics/test/**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The tables and the examples of the Caliper pages: `pnpm caliper-tables` and `pnpm spec-examples` download them.
        resolve: { alias: SOURCES },
        test: {
          name: "learning-analytics-spec",
          include: ["packages/learning-analytics/test/**/*.spec.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The tests that read the contexts that `pnpm schemas` downloads, and sign and verify with Digital Bazaar's suite.
        resolve: { alias: SOURCES },
        test: {
          name: "selective-disclosure-corpus",
          include: ["packages/selective-disclosure/test/**/*.corpus.test.ts"],
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
        // The tests that read the schemas of Open Badges and CLR that `pnpm schemas` downloads, and compare the readers with them.
        resolve: { alias: SOURCES },
        test: {
          name: "achievement-credentials-corpus",
          include: ["packages/achievement-credentials/test/**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The examples and schemas that the pages of Open Badges and CLR print: `pnpm spec-examples` downloads them.
        resolve: { alias: SOURCES },
        test: {
          name: "achievement-credentials-spec",
          include: ["packages/achievement-credentials/test/**/*.spec.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The tests that read files that `pnpm schemas` downloads and compare the readers with them.
        resolve: { alias: SOURCES },
        test: {
          name: "learning-records-corpus",
          include: ["packages/learning-records/test/**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The tests that read the repositories that `pnpm corpus` downloads: CATAPULT's course examples and packages, compared
        // with libxml2 and the schema of cmi5.
        resolve: { alias: SOURCES },
        test: {
          name: "course-launch-corpus",
          include: ["packages/course-launch/test/**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The examples, the schema and the requirements of cmi5, in the repositories that `pnpm corpus` downloads.
        resolve: { alias: SOURCES },
        test: {
          name: "course-launch-spec",
          include: ["packages/course-launch/test/**/*.spec.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The benchmarks and budgets of the package: `pnpm bench` runs them with `vitest bench`, which gives the project the
        // suffix "(bench)". They time the build that ships, which `pnpm bench` makes first, because Vite's rewrite of the imports
        // of a source file makes it slower.
        resolve: {
          alias: [
            {
              find: /^@interopkit\/competency-frameworks$/,
              replacement: resolve(import.meta.dirname, "packages/competency-frameworks/dist/index.js"),
            },
            {
              find: /^@interopkit\/competency-frameworks\/(.+)$/,
              replacement: resolve(import.meta.dirname, "packages/competency-frameworks/dist/$1/index.js"),
            },
          ],
        },
        test: {
          name: "competency-frameworks-bench",
          include: [],
          server: { deps: { external: [/\/packages\/competency-frameworks\/dist\//] } },
          testTimeout: 120_000,
          hookTimeout: 120_000,
          benchmark: {
            include: ["packages/competency-frameworks/test/**/*.bench.ts"],
            // Vitest counts the export getters that a benchmark reads, which slows the benchmarks of the package down.
            suppressExportGetterWarnings: true,
          },
        },
      },
      {
        // The benchmarks of learning-analytics: `pnpm bench` runs them with `vitest bench`, against the build that ships, and against
        // the draft 4 schemas of `caliper-spec`, which `pnpm corpus` downloads.
        resolve: {
          alias: [
            {
              find: /^@interopkit\/learning-analytics$/,
              replacement: resolve(import.meta.dirname, "packages/learning-analytics/dist/index.js"),
            },
            {
              find: /^@interopkit\/learning-analytics\/(.+)$/,
              replacement: resolve(import.meta.dirname, "packages/learning-analytics/dist/$1/index.js"),
            },
          ],
        },
        test: {
          name: "learning-analytics-bench",
          include: [],
          server: { deps: { external: [/\/packages\/learning-analytics\/dist\//] } },
          testTimeout: 120_000,
          hookTimeout: 120_000,
          benchmark: {
            include: ["packages/learning-analytics/test/**/*.bench.ts"],
            suppressExportGetterWarnings: true,
          },
        },
      },
      {
        // The benchmarks of tool-integration: `pnpm bench` runs them with `vitest bench`, against the build that ships.
        resolve: {
          alias: [
            {
              find: /^@interopkit\/tool-integration$/,
              replacement: resolve(import.meta.dirname, "packages/tool-integration/dist/index.js"),
            },
            {
              find: /^@interopkit\/tool-integration\/(.+)$/,
              replacement: resolve(import.meta.dirname, "packages/tool-integration/dist/$1/index.js"),
            },
          ],
        },
        test: {
          name: "tool-integration-bench",
          include: [],
          server: { deps: { external: [/\/packages\/tool-integration\/dist\//] } },
          testTimeout: 120_000,
          hookTimeout: 120_000,
          benchmark: {
            include: ["packages/tool-integration/test/**/*.bench.ts"],
            suppressExportGetterWarnings: true,
          },
        },
      },
      {
        // The benchmarks of learning-records: `pnpm bench` runs them with `vitest bench`, against the build that ships.
        resolve: {
          alias: [
            {
              find: /^@interopkit\/learning-records$/,
              replacement: resolve(import.meta.dirname, "packages/learning-records/dist/index.js"),
            },
            {
              find: /^@interopkit\/learning-records\/(.+)$/,
              replacement: resolve(import.meta.dirname, "packages/learning-records/dist/$1/index.js"),
            },
          ],
        },
        test: {
          name: "learning-records-bench",
          include: [],
          server: { deps: { external: [/\/packages\/learning-records\/dist\//] } },
          testTimeout: 120_000,
          hookTimeout: 120_000,
          benchmark: {
            include: ["packages/learning-records/test/**/*.bench.ts"],
            suppressExportGetterWarnings: true,
          },
        },
      },
      {
        // The speed of verifyCredential against did-jwt-vc and Digital Bazaar's vc: `pnpm bench` runs it against the build that
        // ships. It reads the contexts that `pnpm schemas` downloads.
        resolve: {
          alias: [
            {
              find: /^@interopkit\/achievement-credentials$/,
              replacement: resolve(import.meta.dirname, "packages/achievement-credentials/dist/index.js"),
            },
            {
              find: /^@interopkit\/achievement-credentials\/(.+)$/,
              replacement: resolve(import.meta.dirname, "packages/achievement-credentials/dist/$1/index.js"),
            },
          ],
        },
        test: {
          name: "achievement-credentials-bench",
          include: [],
          server: { deps: { external: [/\/packages\/achievement-credentials\/dist\//] } },
          testTimeout: 120_000,
          hookTimeout: 120_000,
          benchmark: {
            include: ["packages/achievement-credentials/test/**/*.bench.ts"],
            suppressExportGetterWarnings: true,
          },
        },
      },
      {
        // The benchmarks of core: the keyed cache, the readers of a body, the call to a service and the signing of a JWS, against
        // the build that ships.
        resolve: {
          alias: [
            { find: /^@interopkit\/core$/, replacement: resolve(import.meta.dirname, "packages/core/dist/index.js") },
            {
              find: /^@interopkit\/core\/http$/,
              replacement: resolve(import.meta.dirname, "packages/core/dist/http/index.js"),
            },
          ],
        },
        test: {
          name: "core-bench",
          include: [],
          server: { deps: { external: [/\/packages\/core\/dist\//] } },
          testTimeout: 120_000,
          hookTimeout: 120_000,
          benchmark: {
            include: ["packages/core/test/**/*.bench.ts"],
            suppressExportGetterWarnings: true,
          },
        },
      },
      {
        // The same for the three roles of `ecdsa-sd-2023`, timed against Digital Bazaar's suite in the same run. They read the
        // contexts that `pnpm schemas` downloads.
        resolve: {
          alias: [
            {
              find: /^@interopkit\/selective-disclosure$/,
              replacement: resolve(import.meta.dirname, "packages/selective-disclosure/dist/index.js"),
            },
          ],
        },
        test: {
          name: "selective-disclosure-bench",
          include: [],
          server: { deps: { external: [/\/packages\/selective-disclosure\/dist\//] } },
          testTimeout: 120_000,
          hookTimeout: 120_000,
          benchmark: {
            include: ["packages/selective-disclosure/test/**/*.bench.ts"],
            suppressExportGetterWarnings: true,
          },
        },
      },
      {
        // The benchmarks of course-launch: `pnpm bench` runs them with `vitest bench`, against the build that ships, and against
        // the packages of CATAPULT that `pnpm corpus` downloads.
        resolve: {
          alias: [
            {
              find: /^@interopkit\/course-launch$/,
              replacement: resolve(import.meta.dirname, "packages/course-launch/dist/index.js"),
            },
            {
              find: /^@interopkit\/course-launch\/(.+)$/,
              replacement: resolve(import.meta.dirname, "packages/course-launch/dist/$1/index.js"),
            },
          ],
        },
        test: {
          name: "course-launch-bench",
          include: [],
          server: { deps: { external: [/\/packages\/course-launch\/dist\//] } },
          testTimeout: 120_000,
          hookTimeout: 120_000,
          benchmark: {
            include: ["packages/course-launch/test/**/*.bench.ts"],
            suppressExportGetterWarnings: true,
          },
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
      {
        // The university, the wallet, the employer and the VC-API service: the scenario and the tests of the example run against
        // the sources.
        resolve: { alias: SOURCES },
        test: {
          name: "example-achievement-credentials",
          include: ["examples/achievement-credentials/test/**/*.test.ts"],
          exclude: ["**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The credentials of the example through the public validator of 1EdTech in a container: `pnpm validator` builds it,
        // starts it and runs them.
        resolve: { alias: SOURCES },
        test: {
          name: "example-achievement-credentials-validator",
          include: ["examples/achievement-credentials/test/validator.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
          hookTimeout: HANG_LIMIT,
        },
      },
      {
        // The ministry and the school platform: the scenario and the tests of the example run against the sources.
        resolve: { alias: SOURCES },
        test: {
          name: "example-competency-frameworks",
          include: ["examples/competency-frameworks/test/**/*.test.ts"],
          exclude: ["**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The answers of the example provider against the schemas and the OpenAPI document of CASE: `pnpm schemas` downloads them.
        resolve: { alias: SOURCES },
        test: {
          name: "example-competency-frameworks-corpus",
          include: ["examples/competency-frameworks/test/conformance.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The flows of the example against OpenSALT in containers: `pnpm opensalt` starts it and runs them.
        resolve: { alias: SOURCES },
        test: {
          name: "example-competency-frameworks-opensalt",
          include: ["examples/competency-frameworks/test/opensalt.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
          hookTimeout: HANG_LIMIT,
        },
      },
      {
        // The campus LRS in memory, its learning platform and its dashboard: the scenario and the tests run against the sources.
        resolve: { alias: SOURCES },
        test: {
          name: "example-learning-records",
          include: ["examples/learning-records/test/**/*.test.ts"],
          exclude: ["**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The LMS of cmi5 over the campus LRS, and the units that it launches: the scenario and the tests run against the sources.
        // @xapi/cmi5, a counterparty unit, names its module build in `module` alone, which the resolution of Vitest skips.
        resolve: {
          alias: [
            ...SOURCES,
            {
              find: /^@xapi\/cmi5$/,
              replacement: resolve(
                import.meta.dirname,
                "examples/course-launch/node_modules/@xapi/cmi5/dist/Cmi5.esm.js",
              ),
            },
          ],
        },
        test: {
          name: "example-course-launch",
          include: ["examples/course-launch/test/**/*.test.ts"],
          exclude: ["**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The verdicts and the flows against SQL LRS in a container: `pnpm sql-lrs` starts it and runs them.
        resolve: { alias: SOURCES },
        test: {
          name: "example-learning-records-sqllrs",
          include: [
            "examples/learning-records/test/sqllrs-verdicts.corpus.test.ts",
            "examples/learning-records/test/sqllrs.corpus.test.ts",
          ],
          testTimeout: HANG_LIMIT,
          hookTimeout: HANG_LIMIT,
        },
      },
      // The counterparties that run in the process of the tests have a project of their own, which `pnpm test:references` runs.
      nodeProject("tool-integration", ["**/references*.test.ts"]),
      {
        // The libraries of other authors that play the tool against the platform of the package: `pnpm test:references`.
        resolve: { alias: SOURCES },
        test: {
          name: "tool-integration-references",
          include: ["packages/tool-integration/test/references*.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The flows against Moodle in containers: `pnpm moodle` starts it and runs them.
        resolve: { alias: SOURCES },
        test: {
          name: "tool-integration-moodle",
          include: ["packages/tool-integration/test/moodle.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
          hookTimeout: HANG_LIMIT,
        },
      },
      {
        // The flows against PyLTI1p3 in a container: `pnpm pylti1p3` starts it and runs them.
        resolve: { alias: SOURCES },
        test: {
          name: "tool-integration-pylti1p3",
          include: ["packages/tool-integration/test/pylti1p3.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
          hookTimeout: HANG_LIMIT,
        },
      },
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
        // The path of a sensor, which a web application runs in the engines of the browsers.
        resolve: { alias: SOURCES },
        test: {
          name: "learning-analytics-browser",
          include: ["packages/learning-analytics/test/**/*.browser.test.ts"],
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
        // The test vectors of the ecdsa-sd-2023 Recommendation: `pnpm spec-examples` downloads them.
        resolve: { alias: SOURCES },
        test: {
          name: "selective-disclosure-spec",
          include: ["packages/selective-disclosure/test/**/*.spec.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The examples of the xAPI base standard: `pnpm spec-examples` downloads them.
        resolve: { alias: SOURCES },
        test: {
          name: "learning-records-spec",
          include: ["packages/learning-records/test/**/*.spec.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The examples of the specifications: `pnpm spec-examples` downloads them.
        resolve: { alias: SOURCES },
        test: {
          name: "tool-integration-spec",
          include: ["packages/tool-integration/test/**/*.spec.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        test: {
          name: "scripts",
          include: ["scripts/test/**/*.test.ts"],
          // The test of check-rules runs Vitest twice in a copy of the repository for each rule it checks.
          testTimeout: HANG_LIMIT,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      // One floor for each module, so that a gap in the tests of a module fails its own floor and no other.
      thresholds: FLOORS,
    },
  },
});
