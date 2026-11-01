import { DataError, type Random } from "@interopkit/core";
import { checkNonNegativeInteger, checkPositiveInteger, checkRecord, describe } from "@interopkit/core/checks";

/** The fewest entries that a status list has (Bitstring Status List 2.1, privacy): a smaller list narrows who a bit may be. */
export const MIN_LIST_LENGTH = 131_072;

/** The most bytes that a status list inflates to. A list of 134,217,728 entries is this long, and none needs more. */
export const MAX_INFLATED_BYTES = 16_777_216;

const BITS_PER_BYTE = 8;

/** A list of entries of one bit each, as plain data a host stores as it is. Entry 0 is the most significant bit of the first byte. */
export interface StatusList {
  /** The number of entries: a multiple of 8, at least 131,072. */
  readonly length: number;
  /** The bits, `length / 8` bytes. */
  readonly bits: Uint8Array;
}

/** The options of `createStatusList`. */
export interface CreateStatusListOptions {
  /**
   * The number of entries: a multiple of 8, at least 131,072 and at most 134,217,728.
   *
   * @defaultValue `131072`
   */
  readonly length?: number;
}

/** Checks that a number is a length that a list may have: a multiple of 8, at least the least and at most the most. */
function checkLength(length: unknown, label: string): asserts length is number {
  checkPositiveInteger(length, label);
  if (length < MIN_LIST_LENGTH || length > MAX_INFLATED_BYTES * BITS_PER_BYTE || length % BITS_PER_BYTE !== 0) {
    throw new DataError(
      `${label} must be a multiple of 8 from ${MIN_LIST_LENGTH} to ${MAX_INFLATED_BYTES * BITS_PER_BYTE}, found ${length}.`,
    );
  }
}

/**
 * Creates a status list with no entry set.
 *
 * @param options - The number of entries.
 * @returns The list, whose entries are all clear.
 * @throws `DataError` when the length is not a multiple of 8 between 131,072 and 134,217,728.
 */
export function createStatusList(options: CreateStatusListOptions = {}): StatusList {
  checkRecord(options, "The options of createStatusList must be an object");
  const { length = MIN_LIST_LENGTH } = options;
  checkLength(length, "The option length");
  return { length, bits: new Uint8Array(length / BITS_PER_BYTE) };
}

/** Checks a list as a host passes it from JavaScript: a length that a list may have, and the bytes that it needs. */
export function checkStatusList(list: unknown): asserts list is StatusList {
  checkRecord(list, "The status list must be an object");
  checkLength(list.length, "The length of the status list");
  if (!(list.bits instanceof Uint8Array) || list.bits.byteLength * BITS_PER_BYTE !== list.length) {
    throw new DataError(`The bits of the status list must be a Uint8Array of ${list.length / BITS_PER_BYTE} bytes.`);
  }
}

/** Tells whether an entry of a list is set. The index is within the list. */
export function isSet(bits: Uint8Array, index: number): boolean {
  return (((bits[Math.floor(index / BITS_PER_BYTE)] ?? 0) >> (BITS_PER_BYTE - 1 - (index % BITS_PER_BYTE))) & 1) === 1;
}

/**
 * Returns a list with one entry set or cleared. The list that is passed is not changed.
 *
 * @param list - The list.
 * @param index - The entry, from 0 to `length - 1`.
 * @param set - `true` to set the entry (revoke or suspend), `false` to clear it.
 * @returns A new list.
 * @throws `DataError` when the list is not a list or the index is outside it.
 */
export function setCredentialStatus(list: StatusList, index: number, set: boolean): StatusList {
  checkStatusList(list);
  checkNonNegativeInteger(index, "The index");
  if (index >= list.length) throw new DataError(`The index ${index} is outside a list of ${list.length} entries.`);
  if (typeof set !== "boolean") throw new DataError(`The state must be true or false, found ${describe(set)}.`);
  const bits = Uint8Array.from(list.bits);
  const byte = Math.floor(index / BITS_PER_BYTE);
  const mask = 1 << (BITS_PER_BYTE - 1 - (index % BITS_PER_BYTE));
  bits[byte] = set ? (bits[byte] ?? 0) | mask : (bits[byte] ?? 0) & ~mask;
  return { length: list.length, bits };
}

/** The options of `allocateStatusIndex`. */
export interface AllocateOptions {
  /** The number of entries of the list. */
  readonly length: number;
  /** Draws a number in [0, 1): `SYSTEM_RANDOM` in production, a seeded source in a test. */
  readonly random: Random;
}

/**
 * Picks a free index of a list at random, as Bitstring Status List 2.1 asks, so that an index says nothing of the order in which
 * credentials were issued.
 *
 * @remarks
 * The draw is uniform over the free indexes: it picks the n-th free index, with n drawn from `random`.
 *
 * @param used - The indexes that are taken.
 * @param options - The length of the list and the source of random numbers.
 * @returns A free index.
 * @throws `DataError` when the list is full, an argument is not valid, or `random` does not return a number in [0, 1).
 */
export function allocateStatusIndex(used: ReadonlySet<number>, options: AllocateOptions): number {
  checkRecord(options, "The options of allocateStatusIndex must be an object");
  checkPositiveInteger(options.length, "The option length");
  if (!(used instanceof Set)) throw new DataError(`The used indexes must be a Set, found ${describe(used)}.`);
  if (typeof options.random !== "function") throw new DataError("The option random must be a function.");
  for (const index of used) {
    if (!Number.isInteger(index) || index < 0 || index >= options.length) {
      throw new DataError(
        `The used indexes must be integers from 0 to ${options.length - 1}, found ${describe(index)}.`,
      );
    }
  }
  const free = options.length - used.size;
  if (free <= 0) throw new DataError(`The list of ${options.length} entries has no free index.`);
  const draw = options.random();
  if (typeof draw !== "number" || !(draw >= 0 && draw < 1)) {
    throw new DataError(`The option random must return a number from 0 up to 1, found ${describe(draw)}.`);
  }
  let index = Math.floor(draw * free);
  for (const taken of [...used].toSorted((first, second) => first - second)) {
    if (taken <= index) index += 1;
  }
  return index;
}
