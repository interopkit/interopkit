import { describe, expect, it } from "vitest";
import {
  checkConsole,
  checkDiagrams,
  checkDownloads,
  checkEntries,
  checkErrorNames,
  checkFamilies,
  checkFileNames,
  checkHistory,
  checkPackageNames,
  checkSectionSigns,
  checkStandards,
  checkTestTitles,
  type Files,
} from "../check-standards.ts";

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
      "packages/core/package.json": '{ "name": "@interopkit/lti" }',
      "packages/tool-integration/package.json": '{ "name": "@interopkit/tool-integration" }',
      "packages/tool-integration/src/lti-launch.ts": "",
    });
    expect(checkPackageNames(files).map(({ file }) => file)).toStrictEqual([
      "packages/lti-tool",
      "docs/caliper",
      "examples/lti",
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

describe("all checks", () => {
  it("reports nothing for a repository that holds the standards", () => {
    const files = repository({
      "README.md": `# A\n\n${DIAGRAM}`,
      "packages/a/src/index.ts": "export const A = 1;\n",
      "packages/a/test/a.test.ts": 'it("returns one", () => {});\n',
    });
    expect(checkStandards(files)).toStrictEqual([]);
  });

  it("names the rule and the line of each violation", () => {
    const files = repository({ "packages/a/src/x.ts": "const a = 1;\n// §1\n" });
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
