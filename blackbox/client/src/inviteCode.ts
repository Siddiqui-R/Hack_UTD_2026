// Must match CODE_ALPHABET / CODE_LENGTH in the module.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;

// Uniform random code via rejection sampling over crypto.getRandomValues. Formatted XXXX-XXXX.
export function generateInviteCode(): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out: string;
  do {
    out = '';
    while (out.length < LENGTH) {
      for (const b of crypto.getRandomValues(new Uint8Array(16))) {
        if (b < limit && out.length < LENGTH) out += ALPHABET[b % ALPHABET.length];
      }
    }
  } while (new Set(out).size < 5);
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
