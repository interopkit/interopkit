import { DataError } from "@interopkit/core";

/**
 * Writes a value that the host gave, as a model, and reads what was written back: the reader is the check of the value against
 * its specification, since the host may pass it from plain JavaScript.
 *
 * @param value - The value, of any type.
 * @param refusal - Begins the message of the `DataError` for a value of another shape, such as `The control request is not one`.
 * @param write - The writer of the model.
 * @param read - The reader of what the writer writes.
 * @returns What was written, and what was read back.
 * @throws `DataError` when the writer or the reader refuses the value.
 */
export function writeAndRead<TModel, TWritten, TRead>(
  value: unknown,
  refusal: string,
  write: (model: TModel) => TWritten,
  read: (written: TWritten) => TRead,
): { readonly written: TWritten; readonly read: TRead } {
  try {
    // The writer takes the types of the model, and a member of another kind, such as `null` for an object, fails it with a
    // TypeError; what it writes, the reader then checks in full.
    const written = write(value as TModel);
    return { written, read: read(written) };
  } catch (error) {
    if (error instanceof TypeError) throw new DataError(`${refusal}: ${error.message}.`);
    throw error;
  }
}
