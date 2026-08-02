import { describe, expect, it } from "vitest";
import {
  FIELD_COPY,
  HIDDEN_FIELDS,
  VISIBLE_FIELDS,
  closeRateLabel,
  htoUnderperformingLabel,
  isFieldVisible,
  type FunnelArchetype,
  type SettingsFieldName,
} from "./settingsFields";

const ALL_ARCHETYPES: FunnelArchetype[] = [
  "paid_lto",
  "free_lead",
  "appointment",
  "webinar",
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

  it("every hint is a non-empty string", () => {
    for (const f of VISIBLE_FIELDS) {
      const hint = FIELD_COPY[f].hint;
      expect(typeof hint, `hint type for ${f}`).toBe("string");
      expect(hint.length, `empty hint for ${f}`).toBeGreaterThan(0);
    }
  });

  it("no hint string contains ASCII letters (no English visible)", () => {
    const asciiLetter = /[A-Za-z]/;
    for (const f of VISIBLE_FIELDS) {
      const { hint } = FIELD_COPY[f];
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

  // Spec 012 / FR-026d — the previous test locked in the retired
  // `direct_call` option's product-purchase field visibility. The
  // feature deliberately removes `direct_call` and adds `appointment` /
  // `webinar`. The replacement asserts the spec-012 visibility matrix
  // (contracts/settings-fields.md §3): aov / frontEndRoas /
  // htoConversionRate are HIDDEN for appointment + webinar (their math
  // no longer depends on them); the rate fields are archetype-specific.
  it("aov / frontEndRoas / htoConversionRate are HIDDEN for appointment + webinar (FR-028)", () => {
    for (const f of ["aov", "frontEndRoas", "htoConversionRate"] as const) {
      expect(isFieldVisible(f, "appointment"), `${f} visible for appointment`).toBe(false);
      expect(isFieldVisible(f, "webinar"), `${f} visible for webinar`).toBe(false);
    }
  });

  it("aov / frontEndRoas / htoConversionRate stay visible for paid_lto / free_lead", () => {
    for (const f of ["aov", "frontEndRoas", "htoConversionRate"] as const) {
      for (const a of ["paid_lto", "free_lead"] as const) {
        expect(isFieldVisible(f, a), `${f} invisible for ${a}`).toBe(true);
      }
    }
  });

  it("htoPrice stays visible for every archetype (funnel math needs it)", () => {
    for (const a of ALL_ARCHETYPES) {
      expect(isFieldVisible("htoPrice", a), `htoPrice invisible for ${a}`).toBe(true);
    }
  });

  it("marketCplBenchmark is visible for free_lead / appointment / webinar (FR-020 widening)", () => {
    expect(isFieldVisible("marketCplBenchmark", "free_lead")).toBe(true);
    expect(isFieldVisible("marketCplBenchmark", "appointment")).toBe(true);
    expect(isFieldVisible("marketCplBenchmark", "webinar")).toBe(true);
    expect(isFieldVisible("marketCplBenchmark", "paid_lto")).toBe(false);
  });

  it("rate fields are archetype-specific (FR-005 / FR-006 / FR-007)", () => {
    expect(isFieldVisible("bookRate", "appointment")).toBe(true);
    expect(isFieldVisible("bookRate", "webinar")).toBe(false);
    expect(isFieldVisible("showRate", "appointment")).toBe(true);
    expect(isFieldVisible("showRate", "webinar")).toBe(false);
    expect(isFieldVisible("showUpRate", "webinar")).toBe(true);
    expect(isFieldVisible("showUpRate", "appointment")).toBe(false);
    expect(isFieldVisible("closeRate", "appointment")).toBe(true);
    expect(isFieldVisible("closeRate", "webinar")).toBe(true);
  });

  it("archetype-independent visible fields are visible under every archetype", () => {
    const archetypeIndependent: SettingsFieldName[] = [
      "archetype",
      "inputCurrency",
      "htoPrice",
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

describe("settingsFields — archetype-dependent labels (T037 / T043)", () => {
  it("htoUnderperforming wording is archetype-dependent (FR-028d)", () => {
    expect(htoUnderperformingLabel("paid_lto")).toContain("المنتج الغالي");
    expect(htoUnderperformingLabel("free_lead")).toContain("المنتج الغالي");
    expect(htoUnderperformingLabel("appointment")).toContain("تحجز وتحضر");
    expect(htoUnderperformingLabel("webinar")).toContain("تحضر الندوة");
  });

  it("closeRate label is archetype-dependent (FR-007)", () => {
    // appointment asks "out of every 100 calls, how many end in a sale"
    expect(closeRateLabel("appointment")).toContain("مكالمة");
    // webinar asks "out of every 100 attendees, how many buy"
    expect(closeRateLabel("webinar")).toContain("حاضر");
  });
});
