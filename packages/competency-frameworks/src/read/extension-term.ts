/** The term that extends a vocabulary (Information Model 7.2.1): `ext:` and a name. */
const EXTENSION_TERM = /^ext:[A-Za-z0-9._-]+$/u;

/** Tells whether text is a term that a provider adds to a vocabulary: `ext:` and a name. */
export function isExtensionTerm(text: string): boolean {
  return EXTENSION_TERM.test(text);
}
