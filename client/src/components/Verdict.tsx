import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RULES, VERDICT_META, type RuleCode, type Verdict } from "@shared/qarar";

/** Fixed verdict emoji set: 🔴 kill · 🟡 watch · 🟢 continue · 🛟 rescue · ⏳ too-early */
export function VerdictBadge({ verdict, rule }: { verdict: Verdict; rule: RuleCode }) {
  const m = VERDICT_META[verdict];
  const colorCls =
    verdict === "kill"
      ? "text-v-kill border-v-kill/40 bg-v-kill/10"
      : verdict === "watch"
        ? "text-v-watch border-v-watch/40 bg-v-watch/10"
        : verdict === "continue"
          ? "text-v-continue border-v-continue/40 bg-v-continue/10"
          : verdict === "rescue"
            ? "text-v-rescue border-v-rescue/40 bg-v-rescue/10"
            : "text-v-early border-v-early/40 bg-v-early/10";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-bold whitespace-nowrap ${colorCls}`}
    >
      <span aria-hidden>{m.emoji}</span>
      <span>{m.labelAr}</span>
      <RuleChip rule={rule} />
    </span>
  );
}

/** Rule code chip with rulebook definition tooltip — codes shown verbatim. */
export function RuleChip({ rule }: { rule: RuleCode }) {
  const def = RULES[rule];
  if (!def) return <span className="num text-[10px] opacity-80">{rule}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="num cursor-help rounded bg-white/10 px-1 text-[10px] font-bold tracking-wide underline decoration-dotted underline-offset-2">
          {rule}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-right" dir="rtl">
        <p className="mb-1 font-bold">
          <span className="num">{rule}</span> — {def.titleAr}
        </p>
        <p className="text-xs leading-relaxed opacity-90">{def.defAr}</p>
      </TooltipContent>
    </Tooltip>
  );
}
