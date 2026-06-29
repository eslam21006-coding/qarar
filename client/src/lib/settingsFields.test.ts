import { describe, expect, it } from "vitest";
import {
  FIELD_COPY,
  HIDDEN_FIELDS,
  VISIBLE_FIELDS,
  isFieldVisible,
  type FunnelArchetype,
  type SettingsFieldName,
} from "./settingsFields";

const ALL_ARCHETYPES: FunnelArchetype[] = [
  "paid_lto",
  "free_lead",
  "direct_call",
];

describe("settingsFields — VISIBLE/HIDDEN field sets", () => {
  it("the two sets are disjoint", () => {
    for (const f of VISIBLE_FIELDS) {
      expect(HIDDEN_FIELDS).not.toContain(f);
    }
    for (const f of HIDDEN_FIELDS) {
      expect(VISIBLE_FIELDS).not.toContain(f);
    }
  });

  it("HIDDEN_FIELDS contains exactly the six droppable fields", () => {
    expect([...HIDDEN_FIELDS].sort()).toEqual(
      [
        "liveComponent",
        "offerDescription",
        "ticketPrice",
        "arena",
        "bestInterest",
        "geoTiers",
      ].sort()
    );
  });

  it("every visible field name is unique", () => {
    expect(new Set(VISIBLE_FIELDS).size).toBe(VISIBLE_FIELDS.length);
  });

  it("every hidden field name is unique", () => {
    expect(new Set(HIDDEN_FIELDS).size).toBe(HIDDEN_FIELDS.length);
  });
});

describe("settingsFields — FIELD_COPY contract", () => {
  it("has an entry for every VISIBLE_FIELDS entry", () => {
    for (const f of VISIBLE_FIELDS) {
      expect(FIELD_COPY[f], `missing FIELD_COPY for ${f}`).toBeDefined();
    }
  });

  it("has no entry that isn't a visible field", () => {
    expect(Object.keys(FIELD_COPY).sort()).toEqual(
      [...VISIBLE_FIELDS].sort()
    );
  });

  it("every label is a non-empty string", () => {
    for (const f of VISIBLE_FIELDS) {
      const label = FIELD_COPY[f].label;
      expect(typeof label, `label type for ${f}`).toBe("string");
      expect(label.length, `empty label for ${f}`).toBeGreaterThan(0);
    }
  });

  it("every hint is a non-empty string", () => {
    for (const f of VISIBLE_FIELDS) {
      const hint = FIELD_COPY[f].hint;
      expect(typeof hint, `hint type for ${f}`).toBe("string");
      expect(hint.length, `empty hint for ${f}`).toBeGreaterThan(0);
    }
  });

  it("no copy string contains ASCII letters (no English visible)", () => {
    const asciiLetter = /[A-Za-z]/;
    for (const f of VISIBLE_FIELDS) {
      const { label, hint } = FIELD_COPY[f];
      expect(asciiLetter.test(label), `ASCII letters in label for ${f}: ${label}`).toBe(false);
      expect(asciiLetter.test(hint), `ASCII letters in hint for ${f}: ${hint}`).toBe(false);
    }
  });
});

describe("settingsFields — isFieldVisible predicate", () => {
  it("every hidden field is invisible under every archetype", () => {
    for (const f of HIDDEN_FIELDS) {
      for (const a of ALL_ARCHETYPES) {
        expect(isFieldVisible(f as SettingsFieldName, a), `${f} visible for ${a}`).toBe(
          false
        );
      }
    }
  });

  it("marketCplBenchmark is visible only for free_lead", () => {
    expect(isFieldVisible("marketCplBenchmark", "free_lead")).toBe(true);
    expect(isFieldVisible("marketCplBenchmark", "paid_lto")).toBe(false);
    expect(isFieldVisible("marketCplBenchmark", "direct_call")).toBe(false);
  });

  it("aov, frontEndRoas, htoPrice, htoConversionRate stay visible for direct_call", () => {
    expect(isFieldVisible("aov", "direct_call")).toBe(true);
    expect(isFieldVisible("frontEndRoas", "direct_call")).toBe(true);
    expect(isFieldVisible("htoPrice", "direct_call")).toBe(true);
    expect(isFieldVisible("htoConversionRate", "direct_call")).toBe(true);
  });

  it("aov, frontEndRoas, htoPrice, htoConversionRate are visible for every archetype", () => {
    for (const f of ["aov", "frontEndRoas", "htoPrice", "htoConversionRate"] as const) {
      for (const a of ALL_ARCHETYPES) {
        expect(isFieldVisible(f, a), `${f} invisible for ${a}`).toBe(true);
      }
    }
  });

  it("archetype-independent visible fields are visible under every archetype", () => {
    const archetypeIndependent: SettingsFieldName[] = [
      "archetype",
      "inputCurrency",
      "aov",
      "frontEndRoas",
      "htoPrice",
      "htoConversionRate",
      "htoUnderperforming",
      "dailyBudget",
    ];
    for (const f of archetypeIndependent) {
      for (const a of ALL_ARCHETYPES) {
        expect(isFieldVisible(f, a), `${f} not visible for ${a}`).toBe(true);
      }
    }
  });
});
