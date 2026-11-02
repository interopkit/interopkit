import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PACKAGE = resolve(import.meta.dirname, "..");

/** The packages that process JSON-LD, which a verifier of JWTs never loads. */
const JSON_LD =
  /^(?:@interop\/jsonld(?:-signatures)?|jsonld|rdf-canonize|@interop\/data-integrity-proof|@interop\/ed25519-signature|@interop\/ecdsa-signature|@interopkit\/selective-disclosure|@digitalbazaar\/.*)$/u;

/** The modules a file imports with a static `import` or `export ... from`, which a dynamic `import()` is not. */
function staticImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return ts
    .preProcessFile(source, true, false)
    .importedFiles.map(({ fileName }) => fileName)
    .filter((name) => {
      // `preProcessFile` lists dynamic imports too; a static one is on a line that starts with import or export.
      const quoted = new RegExp(
        String.raw`^\s*(?:import|export)\b[^;]*?from\s*["']${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}["']`,
        "mu",
      );
      const bare = new RegExp(String.raw`^\s*import\s*["']${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}["']`, "mu");
      return quoted.test(source) || bare.test(source);
    });
}

/** Follows the static imports from a file: the files of the package that it reaches, and the packages outside. */
function closure(entry: string): { readonly files: Set<string>; readonly packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const name of staticImports(file)) {
      if (name.startsWith(".")) {
        const target = resolve(dirname(file), name.replace(/\.js$/u, ".ts"));
        queue.push(existsSync(target) ? target : join(target.replace(/\.ts$/u, ""), "index.ts"));
      } else {
        packages.add(name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : (name.split("/")[0] as string));
      }
    }
  }
  return { files, packages };
}

/** The packages that the dependencies of a package pull in, by the `dependencies` of their `package.json`. */
function dependencyClosure(roots: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots].map((name) => ({ name, from: PACKAGE }));
  while (queue.length > 0) {
    const { name, from } = queue.pop() as { name: string; from: string };
    if (seen.has(name) || name.startsWith("node:") || name.startsWith("@interopkit/")) continue;
    seen.add(name);
    let directory = from;
    let manifest: string | undefined;
    for (;;) {
      const candidate = join(directory, "node_modules", name, "package.json");
      if (existsSync(candidate)) {
        manifest = candidate;
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    if (manifest === undefined) continue;
    const dependencies = Object.keys(JSON.parse(readFileSync(manifest, "utf8")).dependencies ?? {});
    for (const dependency of dependencies) queue.push({ name: dependency, from: dirname(realpathSync(manifest)) });
  }
  return seen;
}

describe("the import graph of a verifier of JWTs", () => {
  it.each(["jwt", "keys", "status", "refresh", "verify", "provider"])(
    "holds no processor of JSON-LD in the static imports of %s",
    (module) => {
      const { packages } = closure(join(PACKAGE, "src", module, "index.ts"));
      expect([...packages].filter((name) => JSON_LD.test(name))).toStrictEqual([]);
      expect([...dependencyClosure(packages)].filter((name) => JSON_LD.test(name))).toStrictEqual([]);
    },
  );

  it("reaches the processors of JSON-LD only through the dynamic imports of status", () => {
    const dynamic = readdirSync(join(PACKAGE, "src", "status"))
      .map((name) => readFileSync(join(PACKAGE, "src", "status", name), "utf8"))
      .flatMap((source) => [...source.matchAll(/import\("([^"]+)"\)/gu)].map((match) => match[1]));
    expect(dynamic.toSorted()).toStrictEqual(["../data-integrity/index.js", "../data-integrity/index.js"]);
  });

  it("reaches them from verify through one dynamic import, of the internal entry of data-integrity", () => {
    const sources = readdirSync(join(PACKAGE, "src", "verify")).map((name) =>
      readFileSync(join(PACKAGE, "src", "verify", name), "utf8"),
    );
    const dynamic = sources.flatMap((source) => [...source.matchAll(/import\("([^"]+)"\)/gu)].map((match) => match[1]));
    expect(dynamic).toStrictEqual(["../data-integrity/internal.js"]);
  });

  it("loads the verifier into the provider only through one dynamic import, so that a provider that does not verify never loads it", () => {
    const sources = readdirSync(join(PACKAGE, "src", "provider")).map((name) =>
      readFileSync(join(PACKAGE, "src", "provider", name), "utf8"),
    );
    const dynamic = sources.flatMap((source) => [...source.matchAll(/import\("([^"]+)"\)/gu)].map((match) => match[1]));
    expect(dynamic).toStrictEqual(["../verify/index.js"]);
    const { files } = closure(join(PACKAGE, "src", "provider", "index.ts"));
    expect(
      [...files]
        .filter((file) => file.includes(`${join("src", "verify")}`))
        .map((file) => file.split("/").at(-1))
        .sort(),
    ).toStrictEqual(["internal.ts", "options.ts"]);
  });

  it("holds them in the static imports of data-integrity, which is why status loads it on demand", () => {
    const { packages } = closure(join(PACKAGE, "src", "data-integrity", "index.ts"));
    expect([...packages].filter((name) => JSON_LD.test(name)).length).toBeGreaterThan(0);
  });
});
