/**
 * The characters of a URL by RFC 1738 (2.2): letters, digits, the safe and extra characters, the reserved characters, and
 * `%` before two hexadecimal digits. Space, `~`, `{`, `}`, `|`, `\`, `^`, `[`, `]` and `` ` `` are unsafe and must be encoded, and
 * any character beyond ASCII too.
 */
const RFC_1738_PART = "(?:[A-Za-z0-9$\\-_.+!*'(),;/?:@&=]|%[0-9A-Fa-f]{2})*";

/** A URL of RFC 1738, and a fragment of the same characters after one `#`, which RFC 1738 leaves outside the URL. */
const RFC_1738 = new RegExp(`^${RFC_1738_PART}(?:#${RFC_1738_PART})?$`, "u");

/** The scheme of a URL, which RFC 1738 writes in letters, digits, `+`, `-` and `.`. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/u;

/**
 * The names of the parameters that an LMS adds to the launch URL, in lower case: an assignable unit's own query may not use
 * them, in any case and however encoded, or it could send the token of a learner to an endpoint of the package's choice.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#launch_method | cmi5, 8.1 Launch Method}
 */
const LAUNCH_PARAMETER_NAMES: ReadonlySet<string> = new Set([
  "endpoint",
  "fetch",
  "actor",
  "registration",
  "activityid",
]);

/** What is wrong with the URL of an assignable unit, as a rule and a sentence that reads after the path. */
export interface LaunchUrlProblem {
  readonly rule: "url-empty" | "url-characters" | "url-scheme" | "url-relative" | "url-query";
  readonly message: string;
}

/** What the URL of an assignable unit may be. */
export interface LaunchUrlRules {
  /** Whether the structure is in a ZIP package, where a URL may be relative to its root. */
  readonly packaged: boolean;
  /** The schemes, in lower case, that a fully qualified URL may have. */
  readonly launchSchemes: ReadonlySet<string>;
}

/** Splits a URL into what comes before its query, its query, and its fragment. */
function partsOf(url: string): { readonly path: string; readonly query: string } {
  const hash = url.indexOf("#");
  const withoutFragment = hash < 0 ? url : url.slice(0, hash);
  const mark = withoutFragment.indexOf("?");
  return mark < 0
    ? { path: withoutFragment, query: "" }
    : { path: withoutFragment.slice(0, mark), query: withoutFragment.slice(mark + 1) };
}

/** Decodes the escapes of a segment of a path, or keeps it as written when they are not UTF-8, which then names no file. */
function decodedSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Returns the segments of the path of a relative URL, decoded, with `.` and `..` resolved, or `undefined` when a `..` leaves
 * the root of the package.
 *
 * @param path - The path of a relative URL, without its query and fragment, whose characters are those of RFC 1738.
 */
function packagePathOf(path: string): readonly string[] | undefined {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    // A browser reads %2e as a dot, so an encoded `..` leaves the directory as a written one does.
    const decoded = decodedSegment(segment);
    if (decoded === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else if (decoded !== "." && decoded !== "") segments.push(decoded);
  }
  return segments;
}

/**
 * Returns the file of a package that the URL of an assignable unit names: the decoded path of a relative URL, without its
 * query and fragment. A fully qualified URL, and a relative one that leaves the root, name none.
 */
export function packageFileOf(url: string): string | undefined {
  if (SCHEME.test(url)) return undefined;
  return packagePathOf(partsOf(url).path)?.join("/");
}

/** Finds the first name of the query of a URL that is one of the parameters that the LMS adds, as written. */
function launchParameterIn(query: string): string | undefined {
  for (const name of new URLSearchParams(query).keys()) {
    if (LAUNCH_PARAMETER_NAMES.has(name.toLowerCase())) return name;
  }
  return undefined;
}

/** Judges where a URL may lead: a scheme that the host allows followed by `//`, or a path below the root of a package. */
function placeProblem(url: string, path: string, rules: LaunchUrlRules): LaunchUrlProblem | undefined {
  const scheme = SCHEME.exec(url)?.[1];
  if (scheme !== undefined) {
    return rules.launchSchemes.has(scheme.toLowerCase()) && url.startsWith("//", scheme.length + 1)
      ? undefined
      : {
          rule: "url-scheme",
          message: `${JSON.stringify(url)} does not start with a scheme that the LMS launches followed by ://: use one of ${[...rules.launchSchemes].join(", ")}.`,
        };
  }
  if (!rules.packaged) {
    return {
      rule: "url-relative",
      message: `${JSON.stringify(url)} is relative, and a course structure without a ZIP package names every assignable unit by a fully qualified URL.`,
    };
  }
  return path.startsWith("/") || packagePathOf(path) === undefined
    ? {
        rule: "url-relative",
        message: `${JSON.stringify(url)} does not name a file below the root of the package: write a path relative to that root.`,
      }
    : undefined;
}

/**
 * Judges the trimmed URL of an assignable unit: its characters are those of RFC 1738 (13.1.4); a fully qualified URL has a
 * scheme that the host allows, followed by `://`; a relative one is a path below the root of a ZIP package (14.1, 14.2); and
 * its query names none of the parameters that the LMS adds (8.1).
 *
 * @returns The problems, none for a URL that may be launched: where it leads and what its query names are judged apart.
 */
export function launchUrlProblems(url: string, rules: LaunchUrlRules): readonly LaunchUrlProblem[] {
  if (url === "")
    return [{ rule: "url-empty", message: "is empty: an assignable unit needs the URL of its launch point." }];
  if (!RFC_1738.test(url)) {
    return [
      {
        rule: "url-characters",
        message: `${JSON.stringify(url)} holds a character that RFC 1738 does not allow in a URL: encode it with %.`,
      },
    ];
  }
  const { path, query } = partsOf(url);
  const problems: LaunchUrlProblem[] = [];
  const place = placeProblem(url, path, rules);
  if (place !== undefined) problems.push(place);
  const parameter = launchParameterIn(query);
  if (parameter !== undefined) {
    problems.push({
      rule: "url-query",
      message: `${JSON.stringify(url)} has the query parameter ${JSON.stringify(parameter)}, which the LMS adds to the launch URL itself.`,
    });
  }
  return problems;
}
