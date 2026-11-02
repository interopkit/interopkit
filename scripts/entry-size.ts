import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build, type Plugin } from "esbuild";

/** The repository, whose packages are bundled from their sources. */
const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES = resolve(ROOT, "packages");

/** What a host's bundler gives for an entry point of a package alone. */
export interface EntrySize {
  /** The bytes of the minified bundle. */
  readonly bytes: number;
  /** The bytes of the bundle after gzip at its best level, which is what a server sends. */
  readonly gzip: number;
  /**
   * The modules other than the entry point's own that have code in the bundle, in order: `<package>/<folder>` for a module of
   * the package, `@interopkit/core` for the shared foundation as a whole, and the name of a dependency.
   */
  readonly holds: readonly string[];
}

/**
 * Resolves the packages of the repository and their subpaths to their sources, as the tests do, so that a bundle needs no build.
 * A subpath is a folder with an `index.ts`, except `checks` of `@interopkit/core`, which is a file.
 */
const SOURCES: Plugin = {
  name: "sources",
  setup(bundler) {
    bundler.onResolve({ filter: /^@interopkit\// }, ({ path }) => {
      const [, name = "", ...rest] = path.split("/");
      const subpath = rest.join("/");
      if (name === "core" && subpath === "checks") return { path: resolve(PACKAGES, "core/src/checks.ts") };
      return { path: resolve(PACKAGES, name, "src", subpath, "index.ts") };
    });
  },
};

/** The module that a file of a bundle belongs to, as `EntrySize.holds` names it. */
function moduleOf(file: string): string {
  const dependency = /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\//.exec(`/${file}`);
  if (dependency?.[1] !== undefined) return dependency[1];
  const [name = "", , first = ""] = relative(PACKAGES, resolve(ROOT, file)).split("/");
  return name === "core" ? "@interopkit/core" : `${name}/${first.replace(/\.ts$/u, "")}`;
}

/**
 * Lists the entry points of a package that export code, by their specifiers: the subpaths of its `exports`.
 *
 * @param name - The folder of the package, such as `learning-records`.
 */
export function entryPoints(name: string): readonly string[] {
  const manifest = JSON.parse(readFileSync(resolve(PACKAGES, name, "package.json"), "utf8"));
  return Object.keys(manifest.exports).map((subpath) =>
    subpath === "." ? `@interopkit/${name}` : `@interopkit/${name}/${subpath.slice(2)}`,
  );
}

/** The prefix of the virtual module that re-exports an entry point, which the bundler starts from. */
const ENTRY = "entry:";

/** Resolves the virtual module of an entry point to a module that exports all of it. */
const ENTRY_MODULE: Plugin = {
  name: "entry",
  setup(bundler) {
    bundler.onResolve({ filter: /^entry:/ }, ({ path }) => ({ path: path.slice(ENTRY.length), namespace: "entry" }));
    bundler.onLoad({ filter: /.*/, namespace: "entry" }, ({ path }) => ({
      contents: `export * from ${JSON.stringify(path)};`,
      resolveDir: ROOT,
      loader: "js",
    }));
  },
};

/**
 * Bundles an entry point alone, as a host's bundler does for a page or a worker: esbuild, minified, for the browsers of ES2023,
 * with every dependency in the bundle, and a chunk of its own for what a dynamic `import()` loads. The size and the modules are
 * those of the entry chunk and the chunks that it imports statically, which load with it. A module that they hold and the entry
 * point does not name is one that importing it pulls in.
 *
 * @param specifier - The specifier of the entry point, such as `@interopkit/learning-records/store`.
 */
export async function entrySize(specifier: string): Promise<EntrySize> {
  const result = await build({
    entryPoints: [`${ENTRY}${specifier}`],
    absWorkingDir: ROOT,
    outdir: "entry-size",
    bundle: true,
    splitting: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2023",
    metafile: true,
    plugins: [ENTRY_MODULE, SOURCES],
    logLevel: "silent",
  });
  const outputs = result.metafile.outputs;
  const entry = Object.keys(outputs).find((path) => outputs[path]?.entryPoint !== undefined);
  if (entry === undefined) throw new Error(`esbuild wrote no bundle for ${specifier}.`);
  // The chunks that load with the entry: those that it, or a chunk that loads with it, imports statically.
  const eager = new Set([entry]);
  for (const path of eager) {
    for (const { path: imported, kind } of outputs[path]?.imports ?? []) {
      if (kind === "import-statement" && imported in outputs) eager.add(imported);
    }
  }
  const [, name = "", subpath = ""] = specifier.split("/");
  const own = moduleOf(`packages/${name}/src/${subpath === "" ? "index.ts" : `${subpath}/index.ts`}`);
  const modulesOf = (paths: readonly string[]) =>
    new Set(
      paths.flatMap((path) =>
        Object.entries(outputs[path]?.inputs ?? {})
          .filter(([, { bytesInOutput }]) => bytesInOutput > 0)
          .map(([file]) => moduleOf(file))
          .filter((module) => module !== own),
      ),
    );
  const files = result.outputFiles.filter(({ path }) => eager.has(relative(ROOT, path)));
  return {
    bytes: files.reduce((sum, { contents }) => sum + contents.byteLength, 0),
    gzip: files.reduce((sum, { contents }) => sum + gzipSync(contents, { level: 9 }).byteLength, 0),
    holds: [...modulesOf([...eager])].sort(),
  };
}
