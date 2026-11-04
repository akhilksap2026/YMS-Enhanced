const V: Record<string, number> = {};
let v = 10;
for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") { if (v % 11 === 0) v++; V[c] = v++; }
export function checkDigit(first10: string): number {
  let t = 0;
  [...first10].forEach((ch, i) => { t += (/[A-Z]/.test(ch) ? V[ch] : Number(ch)) * 2 ** i; });
  return (t % 11) % 10;
}
export function validateContainer(raw: string): { valid: boolean; reason?: string; normalized: string } {
  const n = raw.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z]{3}[UJZR]\d{7}$/.test(n)) return { valid: false, reason: "Format must be AAAU1234567", normalized: n };
  return checkDigit(n.slice(0, 10)) === Number(n[10]) ? { valid: true, normalized: n } : { valid: false, reason: `Check digit should be ${checkDigit(n.slice(0, 10))}`, normalized: n };
}
export const withCheck = (first10: string) => first10 + checkDigit(first10);
