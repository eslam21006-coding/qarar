import { describe, expect, it } from "vitest";
import { deriveIsActive } from "./isActive";

describe("deriveIsActive", () => {
  it("admin with inactive subscription is active", () => {
    expect(
      deriveIsActive({ role: "admin", subscriptionStatus: "inactive" }),
    ).toBe(true);
  });

  it("non-admin with active subscription is active", () => {
    expect(
      deriveIsActive({ role: "user", subscriptionStatus: "active" }),
    ).toBe(true);
  });

  it("non-admin with inactive subscription is not active", () => {
    expect(
      deriveIsActive({ role: "user", subscriptionStatus: "inactive" }),
    ).toBe(false);
  });

  it("missing fields are not active", () => {
    expect(deriveIsActive({})).toBe(false);
    expect(deriveIsActive({ role: "user" })).toBe(false);
    expect(deriveIsActive({ subscriptionStatus: "inactive" })).toBe(false);
  });

  it("unknown role/status values are not active (fail closed)", () => {
    expect(
      deriveIsActive({
        role: "guest" as unknown as "user",
        subscriptionStatus: "pending" as unknown as "active",
      }),
    ).toBe(false);
  });
});
