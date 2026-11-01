/**
 * A dictionary from a language tag of RFC 5646 to a string in that language (4.2.7), such as `{ "en-US": "completed" }`. The
 * strings are plain text: a consumer shows markup as code and does not render it.
 */
export interface LanguageMap {
  /** The string in the language that the key names. */
  readonly [tag: string]: string;
}
