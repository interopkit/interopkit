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

/**
 * Bundles an entry point alone, as a host's bundler does for a page or a worker: esbuild, minified, for the browsers of ES2023,
 * with every dependency in the bundle. A module that the bundle holds and the entry point does not name is one that importing
 * it pulls in.
 *
 * @param specifier - The specifier of the entry point, such as `@interopkit/learning-records/store`.
 */
export async function entrySize(specifier: string): Promise<EntrySize> {
  const result = await build({
    stdin: { contents: `export * from ${JSON.stringify(specifier)};`, resolveDir: ROOT, loader: "js" },
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2023",
    metafile: true,
    plugins: [SOURCES],
    logLevel: "silent",
  });
  const [output] = result.outputFiles;
  const [meta] = Object.values(result.metafile.outputs);
  if (output === undefined || meta === undefined) throw new Error(`esbuild wrote no bundle for ${specifier}.`);
  const [, name = "", subpath = ""] = specifier.split("/");
  const own = moduleOf(`packages/${name}/src/${subpath === "" ? "index.ts" : `${subpath}/index.ts`}`);
  const holds = Object.entries(meta.inputs)
    .filter(([, { bytesInOutput }]) => bytesInOutput > 0)
    .map(([file]) => moduleOf(file))
    .filter((module) => module !== own);
  return {
    bytes: output.contents.byteLength,
    gzip: gzipSync(output.contents, { level: 9 }).byteLength,
    holds: [...new Set(holds)].sort(),
  };
}
