import { CALIPER_1_1_CONTEXT, CALIPER_CONTEXT, type CaliperVersion } from "../model/index.js";

/** The context that names each version of Caliper, which an envelope gives as its `dataVersion`. */
const CONTEXT_OF_VERSION = {
  "1.2": CALIPER_CONTEXT,
  "1.1": CALIPER_1_1_CONTEXT,
} as const satisfies Readonly<Record<CaliperVersion, string>>;

/** Returns the context that names a version of Caliper, as an envelope writes it in `dataVersion`. */
export function contextOfVersion<TVersion extends CaliperVersion>(
  version: TVersion,
): (typeof CONTEXT_OF_VERSION)[TVersion] {
  return CONTEXT_OF_VERSION[version];
}

/**
 * Finds the version that a `dataVersion` names, among the versions that an endpoint reads.
 *
 * @returns The version, or `undefined` when the value is the context of no version that the endpoint reads.
 */
export function versionOfContext(dataVersion: string, versions: readonly CaliperVersion[]): CaliperVersion | undefined {
  return versions.find((version) => CONTEXT_OF_VERSION[version] === dataVersion);
}
