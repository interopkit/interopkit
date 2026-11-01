/** Joins the path of an object and the name of one of its properties. */
export function member(path: string, name: string): string {
  return path === "" ? name : `${path}.${name}`;
}

/** Writes the path of an item of a list. */
export function item(path: string, index: number): string {
  return `${path}[${index}]`;
}
