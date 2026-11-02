/**
 * Course structures of the tests, written by hand from `CourseStructure.xsd`: small enough that what the schema and cmi5 say of
 * each can be derived exactly.
 */

export const NAMESPACE = "https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd";

/** A title and a description, as every course, block, objective and assignable unit has them. */
export const TEXTS =
  '<title><langstring lang="en">T</langstring></title><description><langstring lang="en">D</langstring></description>';

/** An objective that blocks and assignable units may name. */
export const OBJECTIVE = `<objective id="https://example.org/objectives/1">${TEXTS}</objective>`;

/** An assignable unit with the attributes given, its texts, and the elements given in place of its url. */
export function au(
  attributes = 'id="https://example.org/au/1"',
  inner = "<url>https://example.org/au/1/index.html</url>",
): string {
  return `<au ${attributes}>${TEXTS}${inner}</au>`;
}

/** A block with the id given and the members given. */
export function block(id: string, members: string): string {
  return `<block id="${id}">${TEXTS}${members}</block>`;
}

/** A course structure with the parts given: what follows the course, and the attributes of the root and of the course. */
export function structure(
  members = au(),
  { root = "", course = 'id="https://example.org/course"', courseInner = TEXTS } = {},
): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<courseStructure xmlns="${NAMESPACE}"${root}><course ${course}>${courseInner}</course>${members}</courseStructure>`;
}

/** A structure whose only assignable unit has the attributes and the content after its texts given. */
export function withUnit(attributes: string, inner = "<url>https://example.org/au/1/index.html</url>"): string {
  return structure(au(`id="https://example.org/au/1" ${attributes}`, inner));
}

/** A structure whose only assignable unit has the URL given, as written. */
export function withUrl(url: string): string {
  return structure(au(undefined, `<url>${url}</url>`));
}
