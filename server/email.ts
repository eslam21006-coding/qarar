import { ENV } from "./_core/env";

/**
 * Send email via Resend API.
 * Used for password reset and email verification.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  if (!ENV.resendApiKey) {
    console.warn("[Email] Resend API key not configured, skipping email");
    return { success: true }; // Don't fail if not configured
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "noreply@adqarar.com",
        to,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("[Email] Resend API error:", error);
      return { success: false, error: error.message || "Failed to send email" };
    }

    const data = await response.json();
    return { success: true, messageId: data.id };
  } catch (err: any) {
    console.error("[Email] Error sending email:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Send password reset email.
 */
export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string
): Promise<{ success: boolean; error?: string }> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>إعادة تعيين كلمة المرور</h2>
      <p>لقد طلبت إعادة تعيين كلمة المرور لحسابك في Qarar.</p>
      <p>
        <a href="${resetUrl}" style="background-color: #3884f4; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          إعادة تعيين كلمة المرور
        </a>
      </p>
      <p>أو انسخ هذا الرابط في متصفحك:</p>
      <p style="word-break: break-all; color: #666;">${resetUrl}</p>
      <p style="color: #999; font-size: 12px;">هذا الرابط صالح لمدة ساعة واحدة فقط.</p>
      <p style="color: #999; font-size: 12px;">إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا البريد.</p>
    </div>
  `;

  return sendEmail(email, "إعادة تعيين كلمة المرور - Qarar", html);
}

/**
 * Send email verification email.
 */
export async function sendVerificationEmail(
  email: string,
  verificationCode: string
): Promise<{ success: boolean; error?: string }> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>تحقق من بريدك الإلكتروني</h2>
      <p>شكراً لإنشاء حساب في Qarar!</p>
      <p>استخدم الكود التالي للتحقق من بريدك الإلكتروني:</p>
      <p style="font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #3884f4;">
        ${verificationCode}
      </p>
      <p style="color: #999; font-size: 12px;">هذا الكود صالح لمدة 10 دقائق فقط.</p>
      <p style="color: #999; font-size: 12px;">إذا لم تقم بإنشاء هذا الحساب، يمكنك تجاهل هذا البريد.</p>
    </div>
  `;

  return sendEmail(email, "تحقق من بريدك الإلكتروني - Qarar", html);
}
