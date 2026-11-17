import "server-only";
import nodemailer, { type SendMailOptions } from "nodemailer";

export type OtpMail = { email: string; otp: string; type: "sign-in" | "email-verification" | "forget-password" | "change-email" };
export class MailError extends Error {
  constructor() { super("验证码邮件暂时无法发送，请稍后重试。"); }
}
export function readSmtpEnvironment(env: Readonly<Record<string, string | undefined>> = process.env) {
  const user = env.QQ_SMTP_USER?.trim();
  const pass = env.QQ_SMTP_AUTH_CODE?.trim();
  if (!user || !/^[a-z\d._%+-]+@(?:qq\.com|vip\.qq\.com|foxmail\.com)$/i.test(user)
    || !pass || pass.length < 8 || pass.length > 128 || /\s|REPLACE|YOUR_|CHANGE_ME/i.test(pass)) throw new MailError();
  return { user, pass };
}
export function qqSmtpOptions(config: ReturnType<typeof readSmtpEnvironment>) {
  return {
    host: "smtp.qq.com", port: 465, secure: true,
    auth: config, tls: { minVersion: "TLSv1.2" as const, rejectUnauthorized: true, servername: "smtp.qq.com" },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 15000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  };
}
type MailTransport = { sendMail: (message: SendMailOptions) => Promise<unknown> };
/** 可注入模拟 SMTP；生产地址固定，不能由请求或环境变量改写。 */
export function createOtpMailer(config: ReturnType<typeof readSmtpEnvironment>, transport: MailTransport = nodemailer.createTransport(qqSmtpOptions(config))) {
  return async ({ email, otp, type }: OtpMail): Promise<void> => {
    if (!/^[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+\.[^\s@,;<>\r\n]+$/.test(email) || !/^\d{6}$/.test(otp)
      || !["sign-in", "email-verification"].includes(type)) throw new MailError();
    try {
      await transport.sendMail({
        from: { name: "JobFlow Pro", address: config.user }, to: { address: email, name: "" },
        subject: type === "sign-in" ? "JobFlow Pro 登录 / 注册验证码" : "JobFlow Pro 邮箱验证",
        text: `您的验证码是：\n${otp}\n\n5 分钟内有效，最多尝试 3 次。请使用最新一封邮件中的验证码。\n请勿将验证码告知他人。如非本人操作，请忽略此邮件。`,
      });
    } catch { throw new MailError(); }
  };
}
let mailer: ReturnType<typeof createOtpMailer> | undefined;
/** 懒加载：未配置 SMTP 不影响原有密码登录和构建。 */
export async function sendOtpEmail(data: OtpMail): Promise<void> {
  mailer ??= createOtpMailer(readSmtpEnvironment());
  await mailer(data);
}
