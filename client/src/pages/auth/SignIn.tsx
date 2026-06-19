import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";
import { LockKeyhole, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

const MSG_INVALID = "البريد الإلكتروني أو كلمة المرور غير صحيحة";
const MSG_GENERIC = "حدث خطأ، حاول مرة أخرى";

function isInvalidCredentialsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as {
    status?: number;
    code?: string;
    message?: string;
    cause?: { status?: number; code?: string };
  };
  const status = anyErr.status ?? anyErr.cause?.status;
  if (status === 401 || status === 400) return true;
  const code = anyErr.code ?? anyErr.cause?.code;
  if (
    code === "INVALID_EMAIL_OR_PASSWORD" ||
    code === "INVALID_CREDENTIALS" ||
    code === "INVALID_EMAIL" ||
    code === "INVALID_PASSWORD"
  ) {
    return true;
  }
  const msg = String(anyErr.message ?? "").toLowerCase();
  if (
    msg.includes("invalid email or password") ||
    msg.includes("invalid credentials") ||
    msg.includes("incorrect password")
  ) {
    return true;
  }
  return false;
}

export default function SignIn() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("أدخل البريد الإلكتروني وكلمة المرور");
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn.email({
        email: trimmedEmail,
        password,
      });

      if (result?.error) {
        const err = result.error;
        if (isInvalidCredentialsError(err)) {
          setError(MSG_INVALID);
        } else {
          setError(MSG_GENERIC);
        }
        return;
      }

      navigate("/", { replace: true });
    } catch (err: unknown) {
      if (isInvalidCredentialsError(err)) {
        setError(MSG_INVALID);
      } else {
        setError(MSG_GENERIC);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submit();
  };

  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4 py-10 text-zinc-100"
    >
      <Card className="w-full max-w-md rounded-2xl border-[#222] bg-[#111] text-zinc-100 shadow-xl">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
            <LockKeyhole className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-extrabold text-white">
            قرار
          </CardTitle>
          <CardDescription className="text-zinc-400">
            سجّل دخولك للمتابعة
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-zinc-200">
                البريد الإلكتروني
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={submitting}
                className="border-[#333] bg-[#1a1a1a] text-white placeholder:text-zinc-500 focus-visible:ring-white/30"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-zinc-200">
                كلمة المرور
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={submitting}
                className="border-[#333] bg-[#1a1a1a] text-white placeholder:text-zinc-500 focus-visible:ring-white/30"
                dir="ltr"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-md bg-white text-base font-bold text-black hover:bg-zinc-200"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جارٍ الدخول…
                </>
              ) : (
                "دخول"
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-400">
            ليس لديك حساب؟{" "}
            <Link
              href="/auth/signup"
              className="font-bold text-white underline-offset-4 hover:underline"
            >
              أنشئ حساباً
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
