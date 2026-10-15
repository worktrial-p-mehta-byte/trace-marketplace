/**
 * Read a request body as JSON, stopping as soon as more than `limit` bytes
 * have arrived. Works whether or not the client sent Content-Length
 * (chunked uploads, HTTP/2), so the limit can't be bypassed by omitting it.
 */
export type LimitedJson =
  { ok: true; value: unknown } | { ok: false; reason: "too_large" | "invalid_json" };

export async function readJsonLimited(req: Request, limit: number): Promise<LimitedJson> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return { ok: false, reason: "too_large" };
  if (!req.body) return { ok: false, reason: "invalid_json" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}
