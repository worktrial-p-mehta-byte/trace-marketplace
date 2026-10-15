import { describe, expect, it } from "vitest";
import { scanText } from "./secret-patterns";

// Fake values below are built at runtime so this file itself passes the scan.
const fakeAnthropic = "sk-" + "ant-" + "a".repeat(30);
const fakeAws = "AKIA" + "ABCDEFGHIJKLMNOP";

describe("secret scan", () => {
  it("flags API keys anywhere", () => {
    expect(scanText("src/a.ts", `const k = "${fakeAnthropic}";`, false)).toHaveLength(1);
    expect(scanText("src/a.ts", `aws=${fakeAws}`, false)[0]?.rule).toBe("AWS access key id");
  });

  it("respects the allow marker", () => {
    expect(scanText("src/a.ts", `x = "${fakeAnthropic}"; // tm-allow-secret`, false)).toEqual([]);
  });

  it("flags raw home paths and emails only in fixtures", () => {
    const line = `"cwd": "/Users/priya/code/app/", "author": "priya@company.io"`;
    expect(scanText("fixtures/s.json", line, true).map((f) => f.rule)).toEqual([
      "Unscrubbed macOS home path",
      "Email address",
    ]);
    expect(scanText("docs/x.md", line, false)).toEqual([]);
  });

  it("accepts scrubbed placeholders in fixtures", () => {
    const line = `"cwd": "/Users/<user>/code/app/", "author": "dev@example.com"`;
    expect(scanText("fixtures/s.json", line, true)).toEqual([]);
  });
});
