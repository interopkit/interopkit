import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The repository. */
const ROOT = resolve(import.meta.dirname, "../../..");

/** Returns a directory of the corpus that `pnpm corpus` downloads, and fails when it is not there. */
function corpusPath(name: string): string {
  const directory = join(ROOT, ".cache/corpus", name);
  if (!existsSync(directory))
    throw new Error(`The corpus ${name} is not downloaded to ${directory}: run pnpm corpus first.`);
  return directory;
}

/** The specification of cmi5 at its pinned commit: `v1/CourseStructure.xsd` and `v1/examples/`. */
export const cmi5Spec = (): string => corpusPath("cmi5-spec");

/** CATAPULT at its pinned commit: its requirements, its course examples and the packages of its LMS suite. */
export const catapult = (): string => corpusPath("catapult");

/** The schema of the course structure of cmi5. */
export const courseStructureXsd = (): string => readFileSync(join(cmi5Spec(), "v1/CourseStructure.xsd"), "utf8");
