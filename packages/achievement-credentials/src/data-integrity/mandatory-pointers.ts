import { isRecord } from "@interopkit/core/checks";

/** The properties that every credential of Open Badges 3.0 and CLR 2.0 requires (OB B.1.2, B.1.7, CLR B.1.1). */
const CREDENTIAL = ["/@context", "/id", "/type", "/issuer/id", "/issuer/type", "/validFrom", "/name"] as const;

/** The properties of an Achievement that it requires (OB B.1.1). */
const ACHIEVEMENT = ["id", "type", "criteria", "description", "name"] as const;

/** The pointers of the subject that tell who it is: a holder who hides them leaves a subject that nothing identifies. */
const SUBJECT_IDENTITY = ["id", "identifier"] as const;

/** Reads a JSON Pointer without escapes, which is all that the pointers of this module need. */
function lookup(document: unknown, pointer: string): unknown {
  let current: unknown = document;
  for (const segment of pointer.split("/").slice(1)) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Tells whether a credential is of a class, by its `type`. */
function isOfClass(credential: Readonly<Record<string, unknown>>, name: string): boolean {
  return Array.isArray(credential.type) && credential.type.includes(name);
}

/**
 * Returns the JSON Pointers to the properties that the model of a credential requires and the credential holds: what an
 * issuer marks as mandatory so that every disclosure of the credential is still a valid credential.
 *
 * @remarks
 * The pointers are those of the required properties of an AchievementCredential (with its achievement), an
 * EndorsementCredential and a ClrCredential, and of the properties that identify the subject, which a subject needs (OB B.1.3).
 */
export function defaultMandatoryPointers(credential: Readonly<Record<string, unknown>>): readonly string[] {
  const wanted: string[] = [...CREDENTIAL, "/credentialSubject/type"];
  for (const name of SUBJECT_IDENTITY) wanted.push(`/credentialSubject/${name}`);
  if (!isOfClass(credential, "ClrCredential") && !isOfClass(credential, "EndorsementCredential")) {
    for (const name of ACHIEVEMENT) wanted.push(`/credentialSubject/achievement/${name}`);
  }
  return wanted.filter((pointer) => lookup(credential, pointer) !== undefined);
}
