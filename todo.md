# Qarar (قرار) — Project TODO

## Phase 2 — Data layer & auth
- [x] DB schema: meta_connections (encrypted tokens), ad_accounts, funnel_settings, insight_snapshots, action_checks
- [x] AES-256-GCM token encryption helper
- [x] Facebook OAuth flow (login redirect, /api/meta/callback, long-lived token exchange)
- [x] List ad accounts from token, user picks account(s) to monitor
- [x] Meta Insights fetcher: hierarchy (campaigns→adsets→ads) + windows (3d rolling, today, last_7d daily, baselines 90d median Link CTR / 14d avg CPM / 30d median CPA)
- [x] Spend-share computation per ad within ad set (K5)
- [x] Snapshot caching in DB + manual refresh endpoint (no API hit on navigation)
- [x] Rate limit handling (error mapping; level-scoped account insights keeps call count low)
- [x] Demo mode with realistic synthetic account (covers all verdicts)
- [x] Disconnect & delete my data action (token revoke + data delete)

## Phase 3 — Decision engine
- [x] Derived targets: rawTargetCPA, fullBuyerValue, maxCPA, effectiveCPA + capped flag
- [x] Data gates (impressions/spend thresholds, 3d rolling, learning phase flag, 10% spend share gate)
- [x] Circuit breaker CB1/CB2 (today's data)
- [x] Kill rules K1–K7
- [x] Starved-ad matrix (K5 → leave/kill/rescue 💟)
- [x] 72-hour decay map (flash creative K4, real, strong)
- [x] Fatigue signals (CTR drop ≥25–30% vs 3d peak w/ stable CPM; CPM penalty)
- [x] Watch rules W1–W6
- [x] Continue/Scale S1–S4 + promotion eligibility
- [x] Diagnosis ladder (CPM → Link CTR → CTR-All mismatch → LP view rate → page CVR → post-conversion) Arabic one-liner
- [x] Account summary: total_spend_3d, bleed_daily, verdict counts, baselines, top_3_actions
- [x] Vitest unit tests vs hand-computed rulebook cases (23 engine tests passing)

## Phase 4 — Frontend
- [x] Dark "ads terminal" theme, full RTL, Tajawal/Cairo + monospace for numbers
- [x] Connect screen (وصّل حساب ميتا + account picker + demo mode entry)
- [x] Funnel settings form (archetype, live toggle, offer text, ticket/AOV/HTO/rate/ROAS/budget, arena, best interest, geo tiers)
- [x] Derived targets card + cap warning
- [x] Dashboard: top bar (قرار wordmark, account, refresh + timestamp, settings)
- [x] Sticky summary strip (3d spend, نزيف يومي, verdict counts, baselines)
- [x] قرارات النهاردة card (top-3 actions, numbered, rule chip, impact, تم checkbox)
- [x] Breadcrumb + decision table with drill-down (campaign→adset→ad)
- [x] Verdict colors/emoji 🔴🟡🟢🛟⏳, CPA colored vs target, Link CTR tier colors, ∞ for 0 conv
- [x] افتح في Ads Manager deep link (real accounts; hidden in demo)
- [x] التشخيص العميق section

## Phase 5 — Polish
- [x] Rule chip tooltips (plain-Arabic definitions)
- [x] March-2026 attribution caveat banner
- [x] Skeleton loading rows
- [x] Empty/error/re-auth states (honest ⏳, مفيش حملات, اتصالك انتهى)
- [x] Privacy policy + terms pages (Arabic)
- [x] Mobile responsive + reduced-motion
- [x] Monthly settings review prompt

## Phase 6 — Hardening & acceptance
- [x] All vitest tests pass (31 tests: engine 27 + crypto 3 + auth 1)
- [x] No cross-user data leakage (all queries scoped by userId via requireAccount)
- [x] Read-only: no write calls to Meta (ads_read scope only)
- [x] Checkpoint + delivery

## Revamp round 2 (user feedback)
- [x] Answer effectiveCPA vs rawTargetCPA question in simple Arabic
- [x] Sweep all copy → simple fusha Arabic (≤6th grade), no jargon
- [x] Targets card: rename to أرقامك المستهدفة, one main "هدف تكلفة العميل" number, formulas hidden behind "كيف حسبنا الرقم ده؟"
- [x] Rule codes (K/W/S): Arabic labels in UI, faded code inside tooltip only
- [x] W5 toggle and all settings copy rewritten in plain Arabic
- [x] Date range selector (today / 3d / 7d / 14d / 30d / custom) — affects table numbers only, verdict stays rulebook windows (note shown)
- [x] Filters: search by name, filter by verdict
- [x] Pull ad creative thumbnails and show in ads table
- [x] Columns in English like Ads Manager: Spend, CPA, Link CTR, Results, CPM, CPC, Hook Rate, Hold Rate, LP View %, % Spend, Frequency
- [x] Sortable columns + column picker (show/hide) persisted in localStorage, sensible defaults
- [x] ads_management scope + pause/resume buttons with confirmation dialog (campaign/adset/ad); demo simulates
- [x] Campaign daily-series fallback (sum children) so campaign spend never shows 0
- [x] Update demo data to include thumbnails, video metrics, statuses
- [x] Tests updated + all passing (39 tests, typecheck clean)
