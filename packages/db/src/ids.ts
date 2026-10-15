import { randomBytes } from "node:crypto";

/** Prefixed, URL-safe random id, e.g. newId("trc") → "trc_k3J9..." */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}
