import { trpc } from "@/lib/trpc";
import { VERDICT_META, RULES, type RuleCode, type Verdict } from "@shared/qarar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, History } from "lucide-react";

interface VerdictHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adAccountId: number;
  objectId: string;
  objectName?: string;
}

interface HistoryEntry {
  verdict: Verdict;
  rule: RuleCode;
  objectName: string | null;
  level: "campaign" | "adset" | "ad";
  cpa: number | null;
  spend3d: number | null;
  ctrLink: number | null;
  evaluatedAt: string;
}

function formatArDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const months = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${day} ${month} ${year} — ${hh}:${mm}`;
}

/**
 * US12 / T054 — per-object verdict history dialog.
 * Each entry shows the verdict emoji, the rule code (faded), and the date in
 * simple Arabic. Single-entry timelines render without error.
 */
export function VerdictHistoryDialog({
  open,
  onOpenChange,
  adAccountId,
  objectId,
  objectName,
}: VerdictHistoryDialogProps) {
  const { data, isLoading, error } = trpc.history.getForObject.useQuery(
    { adAccountId, objectId },
    { enabled: open }
  );
  const entries: HistoryEntry[] = data?.entries ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="text-right max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-muted-foreground" />
            <span>سجل الحكم</span>
            {objectName && (
              <span className="font-bold">«{objectName}»</span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            كل تغيير في الحكم أو القاعدة يظهر كسجل هنا
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto py-2" data-testid="verdict-history-list">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري التحميل…
            </div>
          )}
          {error && (
            <div className="py-6 text-center text-sm text-v-kill">
              فشل تحميل السجل
            </div>
          )}
          {!isLoading && !error && entries.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              لا توجد تغييرات مسجلة بعد
            </div>
          )}
          {entries.length > 0 && (
            <ol className="space-y-2">
              {entries.map((e, i) => {
                const meta = VERDICT_META[e.verdict];
                const ruleTitle = RULES[e.rule]?.titleAr ?? e.rule;
                return (
                  <li
                    key={`${e.evaluatedAt}-${i}`}
                    className="flex items-start gap-2 rounded-md border border-border/40 bg-background/60 p-2"
                  >
                    <span className="text-lg leading-none" aria-hidden>
                      {meta?.emoji ?? "•"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-bold">{meta?.labelAr ?? e.verdict}</span>
                        <span className="text-[11px] text-muted-foreground/70" title={ruleTitle}>
                          {e.rule}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground" dir="ltr">
                        {formatArDate(e.evaluatedAt)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
