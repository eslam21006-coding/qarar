# UI Contract: Sign-In, Sign-Up & Upgrade Screens

Visual + behavioral contracts for the three new screens. All copy is exact and
final (Arabic). All screens: `dir="rtl"`, dark theme (page `#0a0a0a`, white/zinc
text), centered card/content, responsive down to 360px, no emojis in body copy.

---

## S1 — Sign-In (`/auth/signin`, `pages/auth/SignIn.tsx`)

**Layout**: Centered card — surface `#111`, border `#222`, rounded.

**Header**: Title `قرار`; subtitle `سجّل دخولك للمتابعة`.

**Fields** (inputs: bg `#1a1a1a`, border `#333`, white text, zinc placeholder):

| Field | Label | Notes |
|-------|-------|-------|
| Email | `البريد الإلكتروني` | type=email, Arabic placeholder |
| Password | `كلمة المرور` | type=password, Arabic placeholder; **Enter submits** |

**Submit button**: label `دخول`; white bg, black text, full width. Loading label
`جارٍ الدخول…`; disabled while submitting (no double submit).

**Errors**:
- Invalid credentials → `البريد الإلكتروني أو كلمة المرور غير صحيحة`
- Any other failure → `حدث خطأ، حاول مرة أخرى`

**Footer link**: `ليس لديك حساب؟ أنشئ حساباً` → navigates to `/auth/signup`.

**Action**: `signIn.email({ email, password })`. On success → navigate `/` (guard
routes onward). On error → map per table above; clear loading state.

**Acceptance** (maps to spec FR-001…FR-006):
1. Renders at `/auth/signin`, RTL, dark, Arabic labels.
2. Correct credentials → leaves sign-in (guard → dashboard for active users).
3. Wrong credentials → Arabic invalid-credentials message; stays on page.
4. Enter in password field submits.
5. Link reaches sign-up.

---

## S2 — Sign-Up (`/auth/signup`, `pages/auth/SignUp.tsx`)

**Layout**: Visually identical to S1.

**Header**: Title `قرار`; subtitle `أنشئ حساباً جديداً`.

**Fields**:

| Field | Label |
|-------|-------|
| Name | `الاسم` |
| Email | `البريد الإلكتروني` |
| Password | `كلمة المرور` |

**Submit button**: label `إنشاء حساب`; loading label `جارٍ الإنشاء…`; same styling
and disabled-while-submitting rule as S1.

**Errors**:
- Duplicate email → `هذا البريد الإلكتروني مسجّل بالفعل`
- Any other failure → `حدث خطأ، حاول مرة أخرى`

**Footer link**: `لديك حساب؟ سجّل دخولك` → navigates to `/auth/signin`.

**Action**: `signUp.email({ name, email, password })`. On success (autoSignIn) →
navigate `/`; non-admins land on `/upgrade`, admins (`ADMIN_EMAIL`) on the dashboard
— decided by the guard, not hardcoded here.

**Acceptance** (maps to spec FR-007…FR-011, Story 1 & 4):
1. Renders at `/auth/signup`, RTL, dark, Arabic labels.
2. New email → account created → guard shows upgrade (non-admin) or dashboard (admin).
3. Duplicate email → Arabic duplicate message; no second account.
4. Link reaches sign-in.

---

## S3 — Upgrade / Access-Denied (`/upgrade`, `pages/Upgrade.tsx`)

**Layout**: Centered content, dark, RTL.

**Visual**: Lock icon at top (🔒 glyph or a lucide `Lock` icon — the one permitted
decorative glyph).

**Heading**: `اشتراكك غير مفعّل بعد`

**Body**: `للوصول إلى لوحة قرار يجب أن يكون اشتراكك نشطاً. إذا أتممت الدفع ولم يُفعَّل حسابك، تواصل معنا.`

**CTA button**: label `احجز مكالمة الاكتشاف`; white bg, black text, rounded,
prominent. Links to `https://eslamsalah.com/team-discovery-call`, opens in a new tab
(`target="_blank"`, `rel="noopener noreferrer"`).

**Sign-out link**: small link `تسجيل خروج` → `signOut()` then navigate `/auth/signin`.

**Acceptance** (maps to spec FR-012…FR-014, Story 3, Constitution VII):
1. Shown when authenticated and `!isActive`.
2. Heading + body text exact; lock visual present.
3. CTA opens the discovery-call booking page in a new tab.
4. Sign-out ends session and returns to `/auth/signin`.

---

## Cross-cutting acceptance

- No English visible to users on any of the three screens (except an email the user
  types). (FR-022 / SC-005)
- All three render correctly RTL on the dark theme and remain usable at 360px width.
  (FR-023 / SC-006)
- No emoji in body copy; only the upgrade lock glyph is allowed. (FR-024)
- `pnpm check` passes with zero TypeScript errors. (FR-027 / SC-008)
