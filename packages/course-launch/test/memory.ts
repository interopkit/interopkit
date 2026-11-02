/** A mebibyte, in bytes. */
export const MIB = 1024 * 1024;

/** The peak resident memory of the process so far, in bytes. A peak only grows, so a test file measures one reading. */
export const peak = (): number => process.resourceUsage().maxRSS * 1024;

/** Says how far a reading raised the peak, in the annotation of the test. */
export const risen = (rise: number): string => `The peak rose by ${(rise / MIB).toFixed(1)} MiB.`;
