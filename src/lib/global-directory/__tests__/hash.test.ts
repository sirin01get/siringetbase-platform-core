import { describe, expect, it } from "vitest";
import { emailHash, normalizeEmail } from "../hash";

// Normalization drift between instances = the same person gets two
// directory rows — the exact problem the directory exists to prevent
// (GLOBAL/01 §B). These tests pin the normalization contract.
describe("global-directory email hashing", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeEmail("  Anand@Example.COM ")).toBe("anand@example.com");
  });

  it("produces identical hashes for equivalent emails", async () => {
    const a = await emailHash("Anand@Example.com");
    const b = await emailHash(" anand@example.com  ");
    expect(a).toBe(b);
  });

  it("produces sha256 hex (the shape the ingest route validates)", async () => {
    const h = await emailHash("anand@example.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different emails", async () => {
    expect(await emailHash("a@example.com")).not.toBe(await emailHash("b@example.com"));
  });
});
