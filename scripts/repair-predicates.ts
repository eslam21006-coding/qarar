/**
 * US11 / Spec 011 / T027 — pure predicates for the stranded-recovery
 * decision, extracted from scripts/repair-settings.ts so they can be
 * imported by tests without triggering the script's main() (which
 * would `process.exit(2)` on missing required args).
 *
 * Kept in its own file because:
 *   - tests need to import these without running the CLI,
 *   - the production path (repair-settings.ts) imports from here
 *     and uses the same predicate — there is exactly one definition.
 */
export interface PlanStep {
  kind: "re-link orphan" | "recover stranded" | "consolidate duplicates";
  detail: string;
  /** True iff this step would actually write. */
  writes: boolean;
}

/**
 * Pure predicate: would the stranded-recovery step authorize a
 * write (move) for a `findStranded` finding given the live sibling
 * identities from the resolution set?
 *
 * Mirrors the body of the recovery loop exactly:
 *   1. Ghost user row must exist
 *   2. Ghost must have a non-empty ghlContactId
 *   3. Live sibling must exist
 *   4. That sibling's ghlContactId must equal the ghost's
 *
 * Used by:
 *   - scripts/repair-settings.ts (production)
 *   - server/isolation.test.ts (T027)
 */
export function shouldMergeStranded(
  ghost: { ghlContactId: string | null } | undefined,
  liveUser: { ghlContactId: string | null } | undefined
): boolean {
  if (!ghost) return false;
  if (!ghost.ghlContactId || ghost.ghlContactId.length === 0) return false;
  if (!liveUser) return false;
  if (liveUser.ghlContactId !== ghost.ghlContactId) return false;
  return true;
}