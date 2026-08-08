import type { ResolvedValue } from "../types.ts";
export function resolveManual(nonce: string): ResolvedValue {
  if (!nonce.trim()) throw new Error("manual force requires a nonce");
  return { value: nonce.trim() };
}
