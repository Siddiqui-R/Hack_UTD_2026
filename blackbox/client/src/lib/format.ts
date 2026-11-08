import { Timestamp } from 'spacetimedb';

export const tsToDate = (ts: Timestamp) => new Date(Number(ts.microsSinceUnixEpoch / 1000n));

// 2026-11-07 23:49:42Z
export function fmtUtc(d: Date, withSeconds = true) {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, withSeconds ? 19 : 16)}Z`;
}

// <input type="datetime-local"> values, interpreted as UTC.
export const toUtcInput = (d: Date) => d.toISOString().slice(0, 16);
export const fromUtcInput = (v: string) => new Date(`${v}:00Z`);
export const dateToTs = (d: Date) => new Timestamp(BigInt(d.getTime()) * 1000n);

export const shortId = (hex: string) => hex.slice(0, 8);
