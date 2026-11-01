/** The generator polynomial of CRC-32 in its reflected form (PNG 1.2, annex D; ISO 3309). */
const POLYNOMIAL = 0xedb88320;

/**
 * Computes the CRC-32 that PNG writes after each chunk, bit by bit: the credential in a chunk is small, and a table would
 * save time only on bytes that nothing here checksums.
 *
 * @param bytes - The bytes, which for a chunk are its type and its data.
 * @returns The checksum as an unsigned 32-bit integer.
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc ^ byte) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) crc = ((crc & 1) === 1 ? POLYNOMIAL ^ (crc >>> 1) : crc >>> 1) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
