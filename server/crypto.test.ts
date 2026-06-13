import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken } from "./crypto";

describe("token crypto (AES-256-GCM)", () => {
  it("roundtrips a Meta access token", () => {
    const token = "EAABsbCS1234|long-lived-token-value-xyz";
    const enc = encryptToken(token);
    expect(enc).not.toContain(token);
    expect(decryptToken(enc)).toBe(token);
  });

  it("produces a different ciphertext per call (random IV)", () => {
    const token = "same-token";
    expect(encryptToken(token)).not.toBe(encryptToken(token));
  });

  it("rejects tampered ciphertext", () => {
    const enc = encryptToken("secret");
    const parts = enc.split(".");
    parts[parts.length - 1] = parts[parts.length - 1].slice(0, -4) + "AAAA";
    expect(() => decryptToken(parts.join("."))).toThrow();
  });
});
