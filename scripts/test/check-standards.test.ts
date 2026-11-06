import { describe, expect, it } from "vitest";
import {
  checkConsole,
  checkDiagrams,
  checkDownloads,
  checkEntries,
  checkErrorNames,
  checkFamilies,
  checkFileNames,
  checkGuideSections,
  checkHistory,
  checkModuleExamples,
  checkPackageNames,
  checkReadmeSections,
  checkReadonlyResults,
  checkSectionSigns,
  checkSecurityLimits,
  checkStandards,
  checkTestTitles,
  type Files,
} from "../check-standards.ts";
import { familyFiles } from "./family-repository.ts";

/** The files of a repository as the checks read them. */
function repository(files: Record<string, string>): Files {
  return new Map(Object.entries(files));
}

const DIAGRAM = "```mermaid\nflowchart LR\n  A --> B\n```\n";

describe("section signs", () => {
  it("reports a section sign in code and in docs", () => {
    const files = repository({
      "packages/a/src/x.ts": "// Rule §4.1 applies.\n",
      "docs/a/guide.md": "See §2.\n",
      "packages/a/src/y.ts": "// Section 4.1 applies.\n",
    });
    expect(checkSectionSigns(files).map(({ file, line }) => [file, line])).toStrictEqual([
      ["packages/a/src/x.ts", 1],
      ["docs/a/guide.md", 1],
    ]);
  });
});

describe("test titles", () => {
  it("reports a row code, a unit code and a clause number in a title", () => {
    const files = repository({
      "packages/a/test/x.test.ts": [
        'it("reads the score [T48]", () => {});',
        'describe("E19: the reader", () => {});',
        'it("reads the score of clause 3.4.3.1", () => {});',
        'it("answers with the media type (D9)", () => {});',
      ].join("\n"),
    });
    expect(checkTestTitles(files).map(({ line }) => line)).toStrictEqual([1, 2, 3, 4]);
  });

  it("accepts a plain sentence, a version number and code outside a title", () => {
    const files = repository({
      "packages/a/test/x.test.ts": [
        'it("reads QTI 3.0.1 documents", () => {});',
        'it("shares the places at a tied boundary equally", () => {});',
        "const code = [T48];",
      ].join("\n"),
    });
    expect(checkTestTitles(files)).toStrictEqual([]);
  });
});

describe("history", () => {
  it("reports history in prose and in comments, and ignores code and fences", () => {
    const files = repository({
      "docs/a/guide.md": [
        "The reader now accepts a URL.",
        '`previously` in code is skipped, and so is the shipped text "previously".',
        "```ts",
        "// previously",
        "```",
        "The option was renamed.",
      ].join("\n"),
      "packages/a/src/x.ts": "/** Returns the text; it formerly returned bytes. */\nconst previously = 1;\n",
      "packages/a/test/x.test.ts": "// We found that the order matters.\n",
    });
    expect(checkHistory(files).map(({ file, line }) => [file, line])).toStrictEqual([
      ["docs/a/guide.md", 1],
      ["docs/a/guide.md", 6],
      ["packages/a/src/x.ts", 1],
      ["packages/a/test/x.test.ts", 1],
    ]);
  });

  it("accepts a state that changes while the code runs", () => {
    const files = repository({ "docs/a/guide.md": "The tool is no longer open once the item is closed.\n" });
    expect(checkHistory(files)).toStrictEqual([]);
  });
});

describe("file names", () => {
  it("reports utils, helpers and misc files, whatever their folder or extension", () => {
    const files = repository({
      "packages/a/src/utils.ts": "",
      "packages/a/src/x/helpers.ts": "",
      "packages/a/test/misc.ts": "",
      "packages/a/src/utilities.ts": "",
    });
    expect(checkFileNames(files).map(({ file }) => file)).toStrictEqual([
      "packages/a/src/utils.ts",
      "packages/a/src/x/helpers.ts",
      "packages/a/test/misc.ts",
    ]);
  });
});

describe("diagrams", () => {
  it("reports a README, a contributing guide and a guide without a Mermaid diagram", () => {
    const files = repository({
      "README.md": "# A\n",
      "CONTRIBUTING.md": "# A\n",
      "packages/a/README.md": "# A\n",
      "docs/a/guide.md": "# Guide\n",
      "docs/a/diagram.md": `# Guide\n\n${DIAGRAM}`,
      "AGENTS.md": "# Agents\n",
    });
    expect(checkDiagrams(files).map(({ file }) => file)).toStrictEqual([
      "README.md",
      "CONTRIBUTING.md",
      "packages/a/README.md",
      "docs/a/guide.md",
    ]);
  });
});

describe("guide sections", () => {
  const complete = [
    "# Guide",
    "## Quick start",
    "## Errors",
    "## Not included",
    "",
    "| Not included  | Why |",
    "| ------------- | --- |",
    "| Retries       | The caller decides |",
    "",
    "## Differences from the references",
  ].join("\n");

  it("accepts the guide of a module that has every section, and the pages that are not guides of a module", () => {
    const files = repository({
      "docs/a/guide.md": complete,
      "docs/a/evidence.md": "# Evidence\n",
      "docs/a/performance.md": "# Performance\n",
      "docs/a/supported.md": "# Supported\n",
      "docs/a/architecture.md": "# Architecture\n",
      "docs/a/comparators.md": "# Comparators\n",
      "docs/a/spec-gaps.md": "# Spec gaps\n",
    });
    expect(checkGuideSections(files)).toStrictEqual([]);
  });

  it("names each section that the guide of a module lacks, and ignores a heading inside a fence", () => {
    const files = repository({
      "docs/a/guide.md": [
        "# Guide",
        "## Quick start",
        "```md",
        "## Errors",
        "```",
        "## Not included",
        "| Not included | Why |",
      ].join("\n"),
    });
    expect(
      checkGuideSections(files).map(({ rule, message }) => [rule, message.match(/"## ([^"]+)"/)?.[1]]),
    ).toStrictEqual([
      ["guide-sections", "Errors"],
      ["guide-sections", "Differences from the references"],
    ]);
  });

  it("reports a table of what is not included whose header differs, on any page, and a section with no table", () => {
    const files = repository({
      "docs/a/guide.md": `${complete.replace("| Not included  | Why |", "| What | Reason |")}\n`,
      "docs/a/evidence.md": "# Evidence\n\n## Not included\n\nNothing.\n",
    });
    expect(checkGuideSections(files).map(({ file, line, rule }) => [file, line, rule])).toStrictEqual([
      ["docs/a/guide.md", 4, "not-included"],
      ["docs/a/evidence.md", 3, "not-included"],
    ]);
  });
});

describe("README sections", () => {
  const root = "# A\n## Which package\n## Documentation\n## Development\n## Layout\n## License\n";
  const pkg = "# A\n## Quick start\n## Architecture\n## API\n## Supported\n## Documentation\n## License\n";

  it("accepts the sections of the root and of a package in their order, with others between them", () => {
    const files = repository({
      "README.md": root,
      "packages/a/README.md": pkg.replace("## API", "## Install\n## API"),
      "examples/a/README.md": "# Example\n",
    });
    expect(checkReadmeSections(files)).toStrictEqual([]);
  });

  it("names the section that is missing or out of order", () => {
    const files = repository({
      "README.md": root.replace("## Layout\n", ""),
      "packages/a/README.md":
        "# A\n## Quick start\n## API\n## Architecture\n## Supported\n## Documentation\n## License\n",
    });
    expect(
      checkReadmeSections(files).map(({ file, message }) => [file, message.match(/; "([^"]+)" is/)?.[1]]),
    ).toStrictEqual([
      ["README.md", "Layout"],
      ["packages/a/README.md", "API"],
    ]);
  });
});

describe("error names", () => {
  it("reports an error class that carries the name of a package", () => {
    const files = repository({
      "packages/core/src/x.ts": "export class CoreError extends Error {}\nexport class ServiceError extends Error {}\n",
      "packages/tool-integration/src/y.ts": "class ToolIntegrationError extends Error {}\n",
      "packages/core/src/errors.ts": "export class InteropkitError extends Error {}\n",
    });
    expect(checkErrorNames(files).map(({ file, line }) => [file, line])).toStrictEqual([
      ["packages/core/src/x.ts", 1],
      ["packages/tool-integration/src/y.ts", 1],
    ]);
  });
});

describe("families", () => {
  it("reports an import of another family outside the examples", () => {
    const files = repository({
      "packages/core/src/x.ts": 'import { fit } from "@measurekit/psychometrics";\n',
      "packages/core/test/x.test.ts": 'const m = await import("@assesskit/runtime");\n',
      "examples/tool-integration/src/index.ts": 'import { fit } from "@measurekit/psychometrics";\n',
      "packages/core/src/y.ts": 'import { DataError } from "@interopkit/core";\n',
    });
    expect(checkFamilies(files).map(({ file }) => file)).toStrictEqual([
      "packages/core/src/x.ts",
      "packages/core/test/x.test.ts",
    ]);
  });
});

describe("tests that read a download", () => {
  const ImportOracle = 'import { schemaValidator } from "../../../scripts/schema-oracle.js";\n';

  it("reports a test that imports a module that reads a download, once for each import", () => {
    const files = repository({
      "packages/a/test/read.test.ts": `${ImportOracle}import { readSpecPage } from "../../../scripts/spec-examples.js";\n`,
      "packages/a/test/arbitrary.test.ts": 'import { schemaArbitrary } from "../../../scripts/schema-arbitrary.js";\n',
      "packages/a/test/schemas.test.ts": 'import { requireSchemas } from "../../../scripts/schemas.js";\n',
      "examples/a/test/run.test.ts": 'import { fetchCorpus } from "../../../scripts/corpus.js";\n',
    });
    expect(checkDownloads(files).map(({ file, line, rule }) => [file, line, rule])).toStrictEqual([
      ["packages/a/test/read.test.ts", 1, "download"],
      ["packages/a/test/read.test.ts", 2, "download"],
      ["packages/a/test/arbitrary.test.ts", 1, "download"],
      ["packages/a/test/schemas.test.ts", 1, "download"],
      ["examples/a/test/run.test.ts", 1, "download"],
    ]);
  });

  it("reports a test that imports a helper that reads a download, directly or through another helper", () => {
    const files = repository({
      "packages/a/test/oracle.ts": ImportOracle,
      "packages/a/test/official.ts": 'import { officialValidator } from "./oracle.js";\n',
      "packages/a/test/direct.test.ts": 'import { x } from "./oracle.js";\n',
      "packages/a/test/indirect.test.ts": 'import { y } from "./official.js";\n',
      "packages/a/test/plain.test.ts": 'import { z } from "./fixture.js";\n',
    });
    expect(checkDownloads(files).map(({ file }) => file)).toStrictEqual([
      "packages/a/test/direct.test.ts",
      "packages/a/test/indirect.test.ts",
    ]);
  });

  it("allows the corpus tests and the spec tests, and the helpers they share, and the tests of the scripts", () => {
    const files = repository({
      "packages/a/test/oracle.ts": ImportOracle,
      "packages/a/test/schemas.corpus.test.ts": 'import { x } from "./oracle.js";\n',
      "packages/a/test/read.fuzz.corpus.test.ts": ImportOracle,
      "packages/a/test/examples.spec.test.ts": 'import { readSpecPage } from "../../../scripts/spec-examples.js";\n',
      "packages/a/test/spec-examples.test.ts":
        'import { readSpecExamples } from "../../../scripts/spec-examples.js";\n',
      "scripts/test/schemas.test.ts": 'import { downloadSchemas } from "../schemas.ts";\n',
    });
    expect(checkDownloads(files)).toStrictEqual([]);
  });
});

describe("package names", () => {
  it("reports a folder or a package named for a specification, once, at the folder", () => {
    const files = repository({
      "packages/lti-tool/src/index.ts": "",
      "packages/lti-tool/test/a.test.ts": "",
      "docs/caliper/guide.md": "",
      "examples/lti/README.md": "",
      "docs/cmi5-player/guide.md": "",
      "packages/core/package.json": '{ "name": "@interopkit/lti" }',
      "packages/tool-integration/package.json": '{ "name": "@interopkit/tool-integration" }',
      "packages/tool-integration/src/lti-launch.ts": "",
    });
    expect(checkPackageNames(files).map(({ file }) => file)).toStrictEqual([
      "packages/lti-tool",
      "docs/caliper",
      "examples/lti",
      "docs/cmi5-player",
      "packages/core/package.json",
    ]);
  });

  it("accepts a name that holds the letters of a specification inside another word", () => {
    const files = repository({
      "packages/multilingual/src/index.ts": "",
      "packages/core/package.json": '{ "name": "@interopkit/core" }',
    });
    expect(checkPackageNames(files)).toStrictEqual([]);
  });
});

describe("module entries", () => {
  const files = repository({
    "packages/a/src/checks.ts": "",
    "packages/a/src/one/index.ts": "",
    "packages/a/src/one/internal.ts": "",
    "packages/a/src/one/read.ts": "",
    "packages/a/src/one/write.ts": 'import { read } from "./read.js";\n',
    "packages/a/src/one/nested/index.ts": "",
    "packages/a/src/one/nested/deep.ts": 'import { read } from "../read.js";\n',
    "packages/a/src/two/index.ts": "",
    "packages/a/src/two/use.ts": [
      'import { checks } from "../checks.js";',
      'import { one } from "../one/index.js";',
      'import { shared } from "../one/internal.js";',
      'import { read } from "../one/read.js";',
      'import { nested } from "../one/nested/deep.js";',
    ].join("\n"),
    "packages/a/test/one.test.ts": [
      'import { one } from "../src/one/index.js";',
      'import { read } from "../src/one/read.js";',
      'import { checks } from "../src/checks.js";',
    ].join("\n"),
  });

  it("reports an import that reaches a file of another module", () => {
    expect(checkEntries(files).map(({ file, line }) => [file, line])).toStrictEqual([
      ["packages/a/src/one/nested/deep.ts", 1],
      ["packages/a/src/two/use.ts", 4],
      ["packages/a/src/two/use.ts", 5],
      ["packages/a/test/one.test.ts", 2],
    ]);
  });

  it("accepts the entries of a module, its own files and the files of the package root", () => {
    const accepted = [...files].filter(([file]) => file === "packages/a/src/one/write.ts");
    expect(checkEntries(new Map(accepted))).toStrictEqual([]);
  });
});

describe("module examples", () => {
  const Example = "/**\n * Reads a thing.\n *\n * @example\n * ```ts\n * read(); // => 1\n * ```\n */\n";
  const manifest = (name: string, exports: Record<string, string>): string =>
    JSON.stringify({
      name,
      exports: Object.fromEntries(
        Object.entries(exports).map(([subpath, built]) => [
          subpath,
          { types: `./dist/${built}.d.ts`, default: `./dist/${built}.js` },
        ]),
      ),
    });
  const a = manifest("@x/a", { ".": "index", "./one": "one/index", "./checks": "checks" });
  const violations = (files: Record<string, string>) =>
    checkModuleExamples(repository(files)).map(({ file, message }) => [file, message.split(" exports")[0]]);

  it("reports the entry of each subpath whose functions have no example, a file or a folder", () => {
    expect(
      violations({
        "packages/a/package.json": a,
        "packages/a/src/index.ts": "/** Reads. */\nexport function read() {}\n",
        "packages/a/src/one/index.ts": "export function write() {}\n",
        "packages/a/src/checks.ts": "export const check = 1;\n",
      }),
    ).toStrictEqual([
      ["packages/a/src/index.ts", "The subpath @x/a"],
      ["packages/a/src/one/index.ts", "The subpath @x/a/one"],
      ["packages/a/src/checks.ts", "The subpath @x/a/checks"],
    ]);
  });

  it("accepts an exported function with an example in the entry itself", () => {
    const files = {
      "packages/a/package.json": a,
      "packages/a/src/index.ts": `${Example}export function read() {}\n`,
      "packages/a/src/one/index.ts": `${Example}export async function write() {}\n`,
      "packages/a/src/checks.ts": `${Example}export function check() {}\n`,
    };
    expect(violations(files)).toStrictEqual([]);
  });

  it("follows the re-exports of values, whole or by name, to the function that has the example", () => {
    const files = {
      "packages/a/package.json": a,
      "packages/a/src/index.ts": 'export { read } from "./read/index.js";\nexport * from "./one/index.js";\n',
      "packages/a/src/read/index.ts": 'export { read } from "./read.js";\n',
      "packages/a/src/read/read.ts": `${Example}export function read() {}\nexport function other() {}\n`,
      "packages/a/src/one/index.ts": 'export { type Shape, other as write } from "../read/read.js";\n',
      "packages/a/src/checks.ts": `${Example}export function check() {}\n`,
    };
    expect(violations(files)).toStrictEqual([["packages/a/src/one/index.ts", "The subpath @x/a/one"]]);
  });

  it("counts an example of a function that the entry takes by name, and no other", () => {
    const files = {
      "packages/a/package.json": a,
      "packages/a/src/index.ts": 'export { other } from "./read.js";\n',
      "packages/a/src/one/index.ts": 'export { read } from "../read.js";\n',
      "packages/a/src/read.ts": `${Example}export function read() {}\nexport function other() {}\n`,
      "packages/a/src/checks.ts": `${Example}export function check() {}\n`,
    };
    expect(violations(files)).toStrictEqual([["packages/a/src/index.ts", "The subpath @x/a"]]);
  });

  it("follows a re-export from another package of the family by the subpath it names", () => {
    const files = {
      "packages/a/package.json": a,
      "packages/b/package.json": manifest("@x/b", { ".": "index", "./deep": "deep/index" }),
      "packages/a/src/index.ts": 'export { read } from "@x/b";\nexport type { Shape } from "@x/b/deep";\n',
      "packages/a/src/one/index.ts": 'export { read } from "@x/b/deep";\n',
      "packages/a/src/checks.ts": `${Example}export function check() {}\n`,
      "packages/b/src/index.ts": 'export { read } from "./read.js";\n',
      "packages/b/src/read.ts": `${Example}export function read() {}\n`,
      "packages/b/src/deep/index.ts": "export function read() {}\n",
    };
    expect(violations(files)).toStrictEqual([
      ["packages/a/src/one/index.ts", "The subpath @x/a/one"],
      ["packages/b/src/deep/index.ts", "The subpath @x/b/deep"],
    ]);
  });

  it("ignores what is not a function with an example that the entry exports", () => {
    const files = {
      "packages/a/package.json": a,
      "packages/a/src/index.ts": `${Example}function read() {}\n`,
      "packages/a/src/one/index.ts": `${Example}export const read = () => 1;\n`,
      "packages/a/src/checks.ts": 'export type { Shape } from "./shape.js";\nexport { type make } from "./shape.js";\n',
      "packages/a/src/shape.ts": `${Example}export function make() {}\n`,
    };
    expect(violations(files).map(([file]) => file)).toStrictEqual([
      "packages/a/src/index.ts",
      "packages/a/src/one/index.ts",
      "packages/a/src/checks.ts",
    ]);
  });

  it("takes the tag at the start of a line of the comment, and not an address such as learner@example.org in its text", () => {
    const files = {
      "packages/a/package.json": manifest("@x/a", { ".": "index" }),
      "packages/a/src/index.ts": "/**\n * Writes `learner@example.org`.\n */\nexport function read() {}\n",
    };
    expect(violations(files)).toStrictEqual([["packages/a/src/index.ts", "The subpath @x/a"]]);
  });

  it("stops at modules that re-export each other", () => {
    const files = {
      "packages/a/package.json": manifest("@x/a", { ".": "index" }),
      "packages/a/src/index.ts": 'export * from "./one.js";\n',
      "packages/a/src/one.ts": 'export * from "./two.js";\n',
      "packages/a/src/two.ts": 'export * from "./one.js";\n',
    };
    expect(violations(files)).toStrictEqual([["packages/a/src/index.ts", "The subpath @x/a"]]);
  });

  it("looks at the subpaths that the manifests build from a source that the repository holds", () => {
    const files = {
      "packages/a/package.json": JSON.stringify({
        name: "@x/a",
        exports: {
          ".": "./dist/index.js",
          "./data": { default: "./data.json" },
          "./one": { default: "./dist/one/index.js" },
        },
      }),
      "packages/b/package.json": "not JSON",
      "packages/c/package.json": JSON.stringify({ name: "@x/c" }),
      "packages/d/package.json": JSON.stringify({ exports: { ".": { default: "./dist/index.js" } } }),
      "packages/a/src/index.ts": "export function read() {}\n",
    };
    expect(violations(files)).toStrictEqual([]);
  });
});

describe("console", () => {
  it("reports a console call in library code, and in no other code", () => {
    const files = repository({
      "packages/a/src/x.ts": 'console.log("x");\n',
      "packages/a/test/x.test.ts": 'console.log("x");\n',
      "scripts/x.ts": 'console.log("x");\n',
    });
    expect(checkConsole(files).map(({ file }) => file)).toStrictEqual(["packages/a/src/x.ts"]);
  });
});

describe("the limits in SECURITY.md", () => {
  const code = {
    "packages/a/src/read.ts": 'throw new LimitError("Too many.", "maxThings", 10);\n',
    "packages/a/src/limits.ts": "export const READ_LIMITS = { maxDepth: 64, maxItems: 100 } as const;\n",
    "packages/a/src/options.ts": "export interface StoreLimits {\n  readonly maxBodyBytes?: number;\n}\n",
    "packages/a/src/index.ts": 'export type { StoreLimits } from "./options.js";\n',
  };

  it("reports each limit of a LimitError, an exported limits object or an exported limits interface that it does not name", () => {
    const found = checkSecurityLimits(repository({ ...code, "SECURITY.md": "| `maxDepth` | 64 | levels |\n" }));
    expect(found.map(({ file, line, rule }) => `${file}:${line} ${rule}`)).toStrictEqual([
      "packages/a/src/read.ts:1 security-limit",
      "packages/a/src/limits.ts:1 security-limit",
      "packages/a/src/options.ts:2 security-limit",
    ]);
    expect(found.map(({ message }) => /limit (\w+)/.exec(message)?.[1])).toStrictEqual([
      "maxThings",
      "maxItems",
      "maxBodyBytes",
    ]);
  });

  it("reports every limit when SECURITY.md is empty or gone, as a merge may leave it", () => {
    expect(checkSecurityLimits(repository({ ...code, "SECURITY.md": "" }))).toHaveLength(4);
    expect(checkSecurityLimits(repository(code))).toHaveLength(4);
  });

  it("accepts a file that names every limit, and leaves out an interface that no entry exports and a limit passed on", () => {
    const files = repository({
      ...code,
      "packages/a/src/inner.ts":
        "export interface InnerLimits {\n  readonly maxHidden: number;\n}\nthrow new LimitError(message, error.limit, error.maximum);\n",
      "SECURITY.md": "`maxThings`, `maxDepth`, `maxItems` and `maxBodyBytes`\n",
    });
    expect(checkSecurityLimits(files)).toStrictEqual([]);
  });
});

describe("all checks", () => {
  it("reports nothing for a repository that holds the standards", () => {
    const files = repository({
      ...familyFiles(),
      "packages/a/src/index.ts": "export const A = 1;\n",
      "packages/a/test/a.test.ts": 'it("returns one", () => {});\n',
    });
    expect(checkStandards(files)).toStrictEqual([]);
  });

  it("holds SECURITY.md to the limits of the packages", () => {
    const files = repository({
      ...familyFiles(),
      "packages/a/src/index.ts": 'export function read() {\n  throw new LimitError("Too many.", "maxThings", 10);\n}\n',
    });
    expect(checkStandards(files).map(({ rule }) => rule)).toStrictEqual(["security-limit"]);
    expect(checkStandards(new Map([...files, ["SECURITY.md", "| `maxThings` | 10 |\n"]]))).toStrictEqual([]);
  });

  it("names the rule and the line of each violation", () => {
    const files = repository({ ...familyFiles(), "packages/a/src/x.ts": "const a = 1;\n// §1\n" });
    expect(checkStandards(files)).toStrictEqual([
      {
        file: "packages/a/src/x.ts",
        line: 2,
        rule: "section-sign",
        message: "Name the rule in words, or link the specification; no section signs.",
      },
    ]);
  });
});

describe("readonly results", () => {
  const index =
    'export { rows, matrix, byId, maybe, table, sorted, pair } from "./x.js";\nexport type { Row } from "./x.js";\n';

  it("reports a public function that returns a mutable list, matrix or record, alone or in a union", () => {
    const files = repository({
      "packages/a/src/m/index.ts": index,
      "packages/a/src/m/x.ts": [
        "export function rows(): Row[] { return []; }",
        "export function matrix(): readonly number[][] { return []; }",
        "export function byId(): Record<string, number> { return {}; }",
        "export function maybe(): Array<number> | null { return null; }",
        "export function table(): Readonly<Record<string, string[]>> { return {}; }",
      ].join("\n"),
    });
    expect(
      checkReadonlyResults(files).map(({ file, line, message }) => [file, line, message.split(";")[0]]),
    ).toStrictEqual([
      ["packages/a/src/m/x.ts", 1, "rows returns Row[]"],
      ["packages/a/src/m/x.ts", 2, "matrix returns number[]"],
      ["packages/a/src/m/x.ts", 3, "byId returns Record<string, number>"],
      ["packages/a/src/m/x.ts", 4, "maybe returns Array<number>"],
      ["packages/a/src/m/x.ts", 5, "table returns string[]"],
    ]);
  });

  it("accepts readonly lists, matrices and records, tuples, promises of them, and a function the module keeps to itself", () => {
    const files = repository({
      "packages/a/src/m/index.ts": index,
      "packages/a/src/m/x.ts": [
        "export function rows(): readonly Row[] { return []; }",
        "export function matrix(): readonly (readonly number[])[] { return []; }",
        "export function byId(): Readonly<Record<string, number>> { return {}; }",
        "export function maybe(): ReadonlyArray<number> | null { return null; }",
        "export function table(): Readonly<Record<string, readonly string[]>> { return {}; }",
        "export function sorted(): Promise<readonly number[]> { return Promise.resolve([]); }",
        "export function hidden(): Row[] { return []; }",
        "export function pair(): [number, number] { return [0, 0]; }",
      ].join("\n"),
    });
    expect(checkReadonlyResults(files).map(({ message }) => message.split(" ")[0])).toStrictEqual([]);
  });
});
