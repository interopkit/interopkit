/** A source of uniform draws in [0, 1), which a host passes where a library must pick at random. */
export type Random = () => number;

/** The bits that a draw holds: those of the mantissa of a double, so that every draw is exact. */
const MANTISSA_BITS = 53;
/** How many of them come from the first of two random words, and how many from the second. */
const HIGH_BITS = 27;
const LOW_BITS = MANTISSA_BITS - HIGH_BITS;
const WORD_BITS = 32;

/**
 * The random source of the system: a uniform draw in [0, 1) from `crypto.getRandomValues`, so that a pick that must be
 * unpredictable, such as a free status list index, is.
 */
export const SYSTEM_RANDOM: Random = () => {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2));
  return ((high >>> (WORD_BITS - HIGH_BITS)) * 2 ** LOW_BITS + (low >>> (WORD_BITS - LOW_BITS))) / 2 ** MANTISSA_BITS;
};
