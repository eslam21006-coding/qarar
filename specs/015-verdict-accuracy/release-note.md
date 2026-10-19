# Release note — 015 Verdict Accuracy: Stop False Kills

**Audience**: account owners and support. **Scope**: spec 015 (P0 false-kill fixes, plus T7b/T7c).

## What changes that users will notice

1. **Paused campaigns are now gated. This is new; they used to be judged.**
   A campaign that is paused, under review, rejected, or blocked by a billing or delivery problem
   now shows ⏳ with a badge naming its real state ("موقوف", "قيد المراجعة", "مرفوض",
   "به مشكلة — راجعه في مدير الإعلانات"). Before this release, a paused **campaign** was judged in
   full by the sales rules, and a paused **ad or ad set** could still be killed by K3, the starved-ad
   matrix or the circuit breaker. Objects in a short post-edit state (`IN_PROCESS`, `PREAPPROVED`)
   are still judged normally, so verdicts no longer flicker after an edit. Archived and deleted
   objects are no longer shown at all. Users may see red counts drop on accounts with paused
   objects. That is intended.

2. **Rescues on small samples disappear.**
   A starved ad is no longer marked 🛟 because of a click-through rate measured on fewer than 500
   impressions in the 3-day window. Below that floor it shows ⏳ "ميتا لا تعطيه فرصة ظهور كافية للحكم
   عليه", in both directions: no 🛟 and no 🔴 from the starved-ad rule. A rescue based on cost per
   result still applies (it needs at least one counted result). An ad also counts as starved only
   if it was under 10% of its ad set's spend on **each** of the last three days, not just on the
   3-day total. **Users who acted on a rescue recommendation may see it vanish.** That is intended.
   The ad-level zero-result kill (K1) keeps no impression floor: an ad that spent twice its target
   with no result is still 🔴.

3. **Stale-snapshot caveat for "unknown, not zero".**
   Qarar now tells "Meta sent no data" apart from "Meta sent a zero". A row with clicks but no
   results array shows ⏳ "ميتا لم ترسل عدد النتائج…" instead of being killed, and a missing sales
   value never shows as a 0.00x return. **Snapshots cached before this release still carry the old
   shape** (a missing value stored as `0`, with no unknown flag), and they are not back-filled. Until
   an account is refreshed once, a genuinely missing figure on that account can still read as zero.
   If a user reports a "0.0x" or a zero-result verdict that contradicts Ads Manager, **refresh the
   account first**.

## Also in this release

- **Settings-mismatch gate**: when the funnel type counts registrations but the campaigns record
  purchases (or the reverse), rows show ⏳ with "راجع نوع الفانل في الإعدادات" instead of a false
  "صرفت … بدون أي نتيجة". When those rows hold at least half of the active spend, a warning card
  appears at the top of the dashboard.
- **New funnel option**: "أقدّم فعالية مدفوعة: ندوة أو تحدٍّ أو ورشة أو ماستر كلاس، ثم أبيع بعدها".
  Every option now says what Qarar counts. Saving a type that contradicts the last 30 days of
  recorded events asks a question first. The question is advisory, and declining keeps the choice.
- **Shown target = judging target**: Settings shows the exact target the engine judges with and
  where it came from. When it differs from the funnel math by more than 20%, both figures appear.
- **No "+20%" advice above target**: a campaign whose cost per result is above target is told
  "واصل بدون زيادة الميزانية".
- **Split red counter**: "للإيقاف: {N} مجموعة · {M} إعلان" counts ad sets and ads only, never
  campaigns, and does not change when the table switches level.
- **Ad-level kill wording**: an ad row now says "أوقِف هذا الإعلان" (it used to say "stop this ad
  set").

No database migration. No new request to Meta. The verdict set is unchanged (🔴 🟡 🟢 🛟 ⏳).
