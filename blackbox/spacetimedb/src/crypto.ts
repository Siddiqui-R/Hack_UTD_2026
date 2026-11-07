import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// The only hashing helper in the module. Lowercase hex SHA-256 of a UTF-8 string.
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

export type Canonical = string | number | boolean | bigint | null | undefined | Canonical[] | { [k: string]: Canonical };

// The only canonical-JSON implementation. Keys sorted, no whitespace, bigint as a decimal
// string, undefined object fields dropped. Non-finite numbers are rejected.
export function canonicalJson(v: Canonical): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'bigint') return JSON.stringify(v.toString());
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('canonicalJson: non-finite number');
    return JSON.stringify(v);
  }
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}
