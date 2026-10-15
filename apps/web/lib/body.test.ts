import { describe, expect, it } from "vitest";
import { readJsonLimited } from "./body";

/** A request whose body arrives in chunks with no Content-Length header. */
function chunked(parts: string[]): Request {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
  return new Request("http://x/api", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
}

describe("readJsonLimited", () => {
  it("parses a body under the limit", async () => {
    await expect(readJsonLimited(chunked(['{"a":', "1}"]), 100)).resolves.toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it("stops a chunked body that grows past the limit, with no Content-Length", async () => {
    const req = chunked(['{"x":"', "a".repeat(60), "a".repeat(60), '"}']);
    expect(req.headers.get("content-length")).toBeNull();
    await expect(readJsonLimited(req, 100)).resolves.toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses early when the declared length is over the limit", async () => {
    const req = new Request("http://x/api", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "999999" },
    });
    await expect(readJsonLimited(req, 100)).resolves.toEqual({ ok: false, reason: "too_large" });
  });

  it("reports invalid JSON", async () => {
    await expect(readJsonLimited(chunked(["not json"]), 100)).resolves.toEqual({
      ok: false,
      reason: "invalid_json",
    });
  });
});
