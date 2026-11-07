import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// The only hashing helper in the module. Lowercase hex SHA-256 of a UTF-8 string.
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}
