import { CheckCircle2 } from "lucide-react";

export default function DataDeletionStatus() {
  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground">
      <main className="container flex min-h-screen items-center justify-center py-10">
        <div className="w-full max-w-xl space-y-6 rounded-2xl border border-border/60 bg-card/60 p-8 text-center shadow-lg backdrop-blur">
          <div className="flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/40">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            طلب حذف البيانات
          </h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            تم استلام طلبك. سيتم حذف جميع بياناتك خلال 30 يوماً.
          </p>
          <p className="num text-xs text-muted-foreground/70">
            QARAR · DATA DELETION REQUEST
          </p>
        </div>
      </main>
    </div>
  );
}
