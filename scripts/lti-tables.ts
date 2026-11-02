/** The vocabularies and variables of LTI 1.3 Core Appendices A and B, as the open portal prints them. */
export interface LtiTables {
  /** The context types, each with the deprecated names the appendix lists beside it. */
  readonly contextTypes: readonly { readonly uri: string; readonly deprecated: readonly string[] }[];
  /** The system roles of the LIS vocabulary, core and non-core. */
  readonly systemRoles: readonly string[];
  /** The institution roles of the LIS vocabulary, core and non-core. */
  readonly institutionRoles: readonly string[];
  /** The context roles of the LIS vocabulary, core and non-core. */
  readonly contextRoles: readonly string[];
  /** The sub-roles of each principal context role, by the name of the principal role. */
  readonly contextSubRoles: Readonly<Record<string, readonly string[]>>;
  /** The roles that LTI itself defines. */
  readonly ltiRoles: readonly string[];
  /** The names of the variables of Appendix B, each once, in the order of the page. */
  readonly variables: readonly string[];
}

/** The sections of the page that hold variables: their `id` ends in `variables` or `variable`. */
const VARIABLE_SECTION = /^[a-z-]+-variables?$/u;

/** Splits a page into the text after each heading of level 2 to 4, by the `id` of the heading. */
function sections(html: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  const headings = [...html.matchAll(/<h[2-4] id="([^"]+)"[^>]*>/gu)];
  headings.forEach((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    found.set(heading[1] ?? "", html.slice(start, headings[index + 1]?.index ?? html.length));
  });
  return found;
}

/** Returns the text of the first table of a section, or the empty string. */
function tableOf(section: string | undefined): string {
  return /<table>([\s\S]*?)<\/table>/u.exec(section ?? "")?.[1] ?? "";
}

/** Returns the rows of a table as the texts of the `code` elements of each row, leaving out the rows that have none. */
function codeRows(table: string): string[][] {
  return table
    .split(/<tr>/u)
    .slice(1)
    .map((row) => [...row.matchAll(/<code>(?:<a[^>]*>)?([^<]+)/gu)].map((code) => (code[1] ?? "").trim()))
    .filter((codes) => codes.length > 0);
}

/** Returns the names of the rows of a table whose first cell is a `code` element, which leaves out the notes under a table. */
function namedRows(table: string): string[] {
  return table
    .split(/<tr>/u)
    .slice(1)
    .flatMap((row) => /^\s*<td[^>]*>\s*<code>([^<]+)<\/code>/u.exec(row)?.[1]?.trim() ?? []);
}

/** Returns every `code` text of a section's first table that starts with a prefix. */
function urisOf(section: string | undefined, prefix: string): string[] {
  return codeRows(tableOf(section))
    .flat()
    .filter((code) => code.startsWith(prefix));
}

/**
 * Reads the vocabularies and variables of LTI 1.3 Core Appendices A and B from the HTML of the open portal's page of the
 * specification.
 *
 * @param html - The page.
 * @throws `Error` when a table that the appendices have is missing.
 */
export function parseLtiTables(html: string): LtiTables {
  const found = sections(html);
  const section = (id: string): string => {
    const text = found.get(id);
    if (text === undefined) throw new Error(`The page has no section ${id}.`);
    return text;
  };
  const Lis = "http://purl.imsglobal.org/vocab/lis/v2";
  const contextTypes = codeRows(tableOf(section("context-type-vocabulary"))).map(([uri = "", ...deprecated]) => ({
    uri,
    deprecated,
  }));
  const subRoles = Object.fromEntries(
    codeRows(tableOf(section("context-sub-roles"))).map(([principal = "", ...names]) => [principal, names]),
  );
  const variables = [...found]
    .filter(([id]) => VARIABLE_SECTION.test(id) && tableOf(found.get(id)) !== "")
    .flatMap(([, text]) => namedRows(tableOf(text)))
    .filter((name, index, names) => names.indexOf(name) === index);
  return {
    contextTypes,
    systemRoles: urisOf(section("lis-vocabulary-for-system-roles"), `${Lis}/system/person#`),
    institutionRoles: urisOf(section("lis-vocabulary-for-institution-roles"), `${Lis}/institution/person#`),
    contextRoles: urisOf(section("lis-vocabulary-for-context-roles"), `${Lis}/membership#`),
    contextSubRoles: subRoles,
    ltiRoles: urisOf(section("lti-vocabulary-for-system-roles"), "http://purl.imsglobal.org/vocab/lti/system/person#"),
    variables,
  };
}
