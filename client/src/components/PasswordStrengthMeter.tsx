import { Check, X } from "lucide-react";
import { useMemo } from "react";

export interface PasswordRequirement {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

const REQUIREMENTS: PasswordRequirement[] = [
  {
    id: "length",
    label: "8 أحرف على الأقل",
    test: (pwd) => pwd.length >= 8,
  },
  {
    id: "uppercase",
    label: "حرف كبير واحد على الأقل",
    test: (pwd) => /[A-Z]/.test(pwd),
  },
  {
    id: "lowercase",
    label: "حرف صغير واحد على الأقل",
    test: (pwd) => /[a-z]/.test(pwd),
  },
  {
    id: "number",
    label: "رقم واحد على الأقل",
    test: (pwd) => /\d/.test(pwd),
  },
  {
    id: "special",
    label: "رمز خاص واحد على الأقل (!@#$%^&*)",
    test: (pwd) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd),
  },
];

export interface PasswordStrengthMeterProps {
  password: string;
  showRequirements?: boolean;
  className?: string;
}

/**
 * Real-time password strength meter component.
 * Shows visual feedback and checklist of password requirements.
 * Calculates strength score (0-100) based on met requirements.
 */
export function PasswordStrengthMeter({
  password,
  showRequirements = true,
  className = "",
}: PasswordStrengthMeterProps) {
  const analysis = useMemo(() => {
    const metRequirements = REQUIREMENTS.filter((req) => req.test(password));
    const strengthScore = (metRequirements.length / REQUIREMENTS.length) * 100;

    let strength: "weak" | "fair" | "good" | "strong" = "weak";
    if (strengthScore >= 100) strength = "strong";
    else if (strengthScore >= 80) strength = "good";
    else if (strengthScore >= 40) strength = "fair";

    return {
      metRequirements,
      strengthScore,
      strength,
      requirementsMet: metRequirements.length,
      totalRequirements: REQUIREMENTS.length,
    };
  }, [password]);

  const getStrengthColor = (strength: "weak" | "fair" | "good" | "strong") => {
    switch (strength) {
      case "strong":
        return { bar: "#10b981", text: "#10b981", label: "قوية جداً" };
      case "good":
        return { bar: "#3b82f6", text: "#3b82f6", label: "قوية" };
      case "fair":
        return { bar: "#f59e0b", text: "#f59e0b", label: "متوسطة" };
      case "weak":
      default:
        return { bar: "#ef4444", text: "#ef4444", label: "ضعيفة" };
    }
  };

  const colors = getStrengthColor(analysis.strength);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Strength bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[#64748b]">قوة كلمة المرور</span>
          <span className="text-xs font-semibold" style={{ color: colors.text }}>
            {colors.label}
          </span>
        </div>
        <div
          className="h-2 w-full rounded-full bg-[#1e293b] overflow-hidden"
          style={{ background: "rgba(15, 23, 42, 0.5)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${analysis.strengthScore}%`,
              background: colors.bar,
            }}
          />
        </div>
      </div>

      {/* Requirements checklist */}
      {showRequirements && (
        <div className="space-y-2 rounded-lg border border-[#334155]/50 bg-[#0f172a]/50 p-3">
          <p className="text-xs font-medium text-[#94a3b8]">المتطلبات:</p>
          <div className="space-y-1.5">
            {REQUIREMENTS.map((req) => {
              const isMet = analysis.metRequirements.some((m) => m.id === req.id);
              return (
                <div
                  key={req.id}
                  className="flex items-center gap-2 text-xs transition-colors"
                  style={{
                    color: isMet ? "#10b981" : "#64748b",
                  }}
                >
                  {isMet ? (
                    <Check className="h-3.5 w-3.5 flex-shrink-0" />
                  ) : (
                    <X className="h-3.5 w-3.5 flex-shrink-0" />
                  )}
                  <span>{req.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Progress indicator */}
      <div className="text-xs text-[#64748b]">
        {analysis.requirementsMet} من {analysis.totalRequirements} متطلبات مستوفاة
      </div>
    </div>
  );
}

/**
 * Check if password meets all requirements.
 * Useful for form validation.
 */
export function isPasswordStrong(password: string): boolean {
  return REQUIREMENTS.every((req) => req.test(password));
}
