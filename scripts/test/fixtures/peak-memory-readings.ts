import { expect } from "vitest";
import { type Reading, refusal } from "../../peak-memory-child.js";

/** The readings of the tests of the harness. */
export const READINGS = {
  /** An input of bytes, which the reading gets as the same kind of bytes. */
  bytes: {
    input: () => new Uint8Array([1, 2, 3]),
    read: (input: Uint8Array) => `${input.constructor.name} of ${input.byteLength} bytes`,
  },
  /** An input of text. */
  text: {
    input: () => "a".repeat(1_000),
    read: (input: string) => `${input.length} characters`,
  },
  /** A reading that keeps 128 MB alive at once. */
  hungry: {
    input: () => undefined,
    read: () => `${Array.from({ length: 16 }, () => new Array(1_000_000).fill(0)).length} lists`,
  },
  /** A reading that throws. */
  refused: {
    input: () => undefined,
    read: () =>
      refusal(() => {
        throw new RangeError("Too long.");
      }),
  },
  /** A reading that asserts as a fake of the tests does, with the `expect` of Vitest. */
  asserting: {
    input: () => undefined,
    read: async () => {
      expect(1, "one").toBe(1);
      expect([1]).not.toBe([1]);
      expect({ a: [1] }).toEqual({ a: [1] });
      expect("abc").toMatch(/b/);
      expect("abc").toContain("c");
      expect([1, 2, 3]).toContain(3);
      expect(2).toBeGreaterThan(1);
      expect(2).toBeLessThanOrEqual(2);
      expect(new RangeError("x")).toBeInstanceOf(Error);
      expect(0).toBeDefined();
      expect(undefined).toBeUndefined();
      expect("x").toBeTruthy();
      return await refusal(() => expect(1, "The fake expected two.").toBe(2));
    },
  },
} satisfies Record<string, Reading>;
