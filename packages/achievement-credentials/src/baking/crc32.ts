/** The generator polynomial of CRC-32 in its reflected form (PNG 1.2, annex D; ISO 3309). */
const POLYNOMIAL = 0xedb88320;

/** The values of a byte. */
const BYTE_VALUES = 256;
const BITS_PER_BYTE = 8;
/** The bits of the lowest byte of a number. */
const BYTE_MASK = 0xff;

/**
 * The CRC-32 of each byte value, the table of PNG 1.2, annex D: one lookup takes the place of eight steps of the polynomial
 * for each byte, which a credential of a few hundred kilobytes otherwise spends most of its reading on.
 */
const TABLE = Uint32Array.from({ length: BYTE_VALUES }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < BITS_PER_BYTE; bit += 1) crc = (crc & 1) === 1 ? POLYNOMIAL ^ (crc >>> 1) : crc >>> 1;
  return crc;
});

/**
 * Computes the CRC-32 that PNG writes after each chunk.
 *
 * @param bytes - The bytes, which for a chunk are its type and its data.
 * @returns The checksum as an unsigned 32-bit integer.
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (TABLE[(crc ^ byte) & BYTE_MASK] ?? 0) ^ (crc >>> BITS_PER_BYTE);
  return (crc ^ 0xffffffff) >>> 0;
}
