import type { EngineRow } from "@shared/qarar";

export type FilterOp = "is" | "is_not" | "contains" | ">=" | "<=" | "between";
export type FilterJoin = "AND" | "OR";

export type FilterField =
  | "name"
  | "objective"
  | "verdict"
  | "status"
  | "level"
  | "spend"
  | "impressions"
  | "cpa"
  | "ctrLink"
  | "cpm";

export interface FilterRule {
  id: string;
  field: FilterField;
  op: FilterOp;
  value: string;
  value2?: string;
}

export interface FilterAgg {
  spend: number;
  impressions: number;
  results: number;
  linkClicks: number;
  clicks: number;
  lpViews: number;
  cpa: number | null;
  ctrLink: number | null;
  ctrAll: number | null;
  cpm: number | null;
  cpc: number | null;
  hookRate: number | null;
  holdRate: number | null;
  lpRate: number | null;
  frequency: number | null;
  spendShare: number | null;
}

export const FILTER_FIELDS: Record<
  FilterField,
  { type: "text" | "enum" | "numeric"; label: string; options?: string[] }
> = {
  name: { type: "text", label: "الاسم" },
  objective: { type: "enum", label: "الهدف" },
  verdict: { type: "enum", label: "الحكم" },
  status: { type: "enum", label: "الحالة", options: ["ACTIVE", "PAUSED"] },
  level: { type: "enum", label: "المستوى" },
  spend: { type: "numeric", label: "الصرف" },
  impressions: { type: "numeric", label: "المشاهدات" },
  cpa: { type: "numeric", label: "تكلفة العميل" },
  ctrLink: { type: "numeric", label: "نسبة النقر" },
  cpm: { type: "numeric", label: "سعر الظهور" },
};

function getNumericValue(
  field: FilterField,
  row: EngineRow,
  agg: FilterAgg | null | undefined,
): number | null {
  switch (field) {
    case "spend":
      return agg?.spend ?? null;
    case "impressions":
      return agg?.impressions ?? null;
    case "cpa":
      return agg?.cpa ?? null;
    case "ctrLink":
      return agg?.ctrLink ?? null;
    case "cpm":
      return agg?.cpm ?? null;
    default:
      return null;
  }
}

function getStringValue(
  field: FilterField,
  row: EngineRow,
  getStatus?: (row: EngineRow) => string,
): string {
  switch (field) {
    case "name":
      return row.name;
    case "objective":
      return row.objective ?? "";
    case "verdict":
      return row.verdict;
    case "status":
      return getStatus ? getStatus(row) : row.status;
    case "level":
      return row.level;
    default:
      return "";
  }
}

export function applyFilters(
  rows: EngineRow[],
  filters: FilterRule[],
  join: FilterJoin,
  aggs: Map<string, FilterAgg | null>,
  getStatus?: (row: EngineRow) => string,
): EngineRow[] {
  if (filters.length === 0) return rows;

  return rows.filter(row => {
    const results = filters.map(f => {
      const meta = FILTER_FIELDS[f.field];
      if (!meta) return true;

      if (meta.type === "numeric") {
        const val = getNumericValue(f.field, row, aggs.get(row.id));
        if (val === null) return false;
        const v = parseFloat(f.value);
        if (f.op === ">=") return val >= v;
        if (f.op === "<=") return val <= v;
        if (f.op === "between") {
          const v2 = parseFloat(f.value2 ?? "0");
          return val >= v && val <= v2;
        }
        return true;
      }

      const sval = getStringValue(f.field, row, getStatus);
      if (f.op === "is") return sval === f.value;
      if (f.op === "is_not") return sval !== f.value;
      if (f.op === "contains")
        return sval.toLowerCase().includes(f.value.toLowerCase());
      return true;
    });

    return join === "AND" ? results.every(Boolean) : results.some(Boolean);
  });
}
