import { createHash } from 'node:crypto';
import { D1Database, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  RESEND_API_KEY: string; // Resend邮件服务API密钥
  XUNHUPAY_APP_ID?: string; // 虎皮椒支付应用ID
  XUNHUPAY_APP_SECRET?: string; // 虎皮椒支付签名密钥
  XUNHUPAY_API_BASE?: string; // 虎皮椒支付网关地址
  Memoraid: AnalyticsEngineDataset; // Analytics Engine 数据集绑定
}

interface AuthRequest {
  provider: 'google' | 'github';
  token: string;
}

interface SaveSettingsRequest {
  encryptedData: string;
  salt: string;
  iv: string;
}

interface PaymentOrderRow {
  id: string;
  user_id: string;
  amount: number;
  quota_amount: number;
  status: string;
  payment_url?: string | null;
  paid_at?: number | null;
}

interface UserQuotaSnapshot {
  freeQuota: number;
  paidQuota: number;
  totalQuota: number;
}

function buildHtmlResponse(html: string, extraHeaders?: Record<string, string>): Response {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
      ...(extraHeaders ?? {}),
    },
  });
}

function getEffectiveOrigin(request: Request, url: URL): string {
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? request.headers.get('X-Forwarded-Proto');
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('X-Forwarded-Host');
  const cfVisitor = request.headers.get('cf-visitor');

  let protocol = url.protocol.replace(':', '');
  if (forwardedProto) protocol = forwardedProto.split(',')[0].trim();
  if (cfVisitor) {
    try {
      const data = JSON.parse(cfVisitor) as { scheme?: string };
      if (data.scheme) protocol = data.scheme;
    } catch {
    }
  }

  const host = forwardedHost ? forwardedHost.split(',')[0].trim() : url.host;
  return `${protocol}://${host}`;
}

/**
 * 使用Resend发送邮件
 * Resend是一个现代化的邮件API服务，适合Cloudflare Workers
 * 官网：https://resend.com
 * 免费额度：每月3000封邮件
 */
async function sendEmailViaResend(apiKey: string, params: {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<Response> {
  // 构建发件人字段，格式：Name <email@domain.com>
  const fromField = params.fromName 
    ? `${params.fromName} <${params.from}>`
    : params.from;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromField,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
    }),
  });

  return response;
}

// 虎皮椒支付使用 MD5 作为签名算法，这里统一封装避免前后逻辑不一致。
function buildMd5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function buildXunhupayHash(
  params: Record<string, string | number | null | undefined>,
  appSecret: string
): string {
  const raw = Object.entries(params)
    .filter(([key, value]) => key !== 'hash' && value !== undefined && value !== null && String(value) !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return buildMd5(raw + appSecret);
}

function getXunhupayConfig(env: Env): { appId: string; appSecret: string; gatewayUrl: string } | null {
  const appId = env.XUNHUPAY_APP_ID?.trim();
  const appSecret = env.XUNHUPAY_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;

  const rawGateway = (env.XUNHUPAY_API_BASE?.trim() || 'https://api.xunhupay.com').replace(/\/$/, '');
  const gatewayUrl = rawGateway.endsWith('.html') ? rawGateway : `${rawGateway}/payment/do.html`;

  return { appId, appSecret, gatewayUrl };
}

async function getUserQuotaSnapshot(env: Env, userId: string): Promise<UserQuotaSnapshot> {
  const quotaRow = await env.DB.prepare(`
    SELECT
      COALESCE(free_quota_remaining, 0) as free_quota,
      COALESCE(paid_quota_remaining, 0) as paid_quota
    FROM user_quotas
    WHERE user_id = ?
  `).bind(userId).first<{ free_quota?: number; paid_quota?: number }>();

  const freeQuota = Number(quotaRow?.free_quota || 0);
  const paidQuota = Number(quotaRow?.paid_quota || 0);
  return {
    freeQuota,
    paidQuota,
    totalQuota: freeQuota + paidQuota,
  };
}

async function loadEmailConfig(env: Env): Promise<{
  emailSender: string;
  emailSenderName: string;
  notificationEmail: string | null;
}> {
  const configs = await env.DB.prepare(
    'SELECT key, value FROM system_configs WHERE key IN (?, ?, ?)'
  ).bind('email_sender', 'email_sender_name', 'email_recipient').all();

  const configMap: Record<string, string> = {};
  configs.results.forEach((row: any) => {
    configMap[row.key] = row.value;
  });

  return {
    emailSender: configMap.email_sender || 'onboarding@resend.dev',
    emailSenderName: configMap.email_sender_name || 'Memoraid',
    notificationEmail: configMap.email_recipient?.trim() || null,
  };
}

async function sendRechargeSuccessEmail(
  env: Env,
  order: PaymentOrderRow,
  quotaSnapshot: UserQuotaSnapshot
): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(order.user_id).first<{ email?: string }>();
  if (!user?.email) return;

  const { emailSender, emailSenderName } = await loadEmailConfig(env);

  const emailResult = await sendEmailViaResend(env.RESEND_API_KEY, {
    from: emailSender,
    fromName: emailSenderName,
    to: user.email,
    subject: '🎉 支付成功通知 - Memoraid',
    text:
      `您好！\n\n您的充值订单已支付成功，额度已自动充值到您的账户。\n\n` +
      `订单号：${order.id}\n充值金额：¥${order.amount}\n增加额度：${order.quota_amount} 次\n\n` +
      `当前账户额度：\n免费额度：${quotaSnapshot.freeQuota} 次\n付费额度：${quotaSnapshot.paidQuota} 次\n总额度：${quotaSnapshot.totalQuota} 次\n\n` +
      `感谢您的支持！\n\nMemoraid 团队`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:linear-gradient(135deg,#10b981 0%,#059669 100%);padding:40px 40px 30px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:32px;font-weight:700;">🎉 支付成功</h1>
              <p style="margin:12px 0 0 0;color:rgba(255,255,255,0.95);font-size:16px;">您的账户额度已自动充值</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 24px 0;color:#374151;font-size:16px;line-height:1.6;">您好！</p>
              <p style="margin:0 0 32px 0;color:#374151;font-size:16px;line-height:1.6;">您的充值订单已支付成功，额度已自动充值到您的账户。现在您可以继续使用 Memoraid 的 AI 内容生成服务了！</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:12px;margin-bottom:24px;border:1px solid #e5e7eb;">
                <tr>
                  <td style="padding:24px;">
                    <h2 style="margin:0 0 16px 0;color:#111827;font-size:18px;font-weight:600;">📋 充值信息</h2>
                    <table width="100%" cellpadding="8" cellspacing="0">
                      <tr>
                        <td style="color:#6b7280;font-size:14px;padding:12px 0;">订单号</td>
                        <td style="color:#111827;font-size:14px;font-weight:600;text-align:right;padding:12px 0;">${order.id}</td>
                      </tr>
                      <tr>
                        <td style="color:#6b7280;font-size:14px;padding:12px 0;">充值金额</td>
                        <td style="color:#10b981;font-size:16px;font-weight:700;text-align:right;padding:12px 0;">¥${order.amount}</td>
                      </tr>
                      <tr>
                        <td style="color:#6b7280;font-size:14px;padding:12px 0;">增加额度</td>
                        <td style="color:#10b981;font-size:16px;font-weight:700;text-align:right;padding:12px 0;">+${order.quota_amount} 次</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border-radius:12px;margin-bottom:32px;border:1px solid #bbf7d0;">
                <tr>
                  <td style="padding:24px;">
                    <h2 style="margin:0 0 16px 0;color:#111827;font-size:18px;font-weight:600;">💰 当前账户额度</h2>
                    <table width="100%" cellpadding="8" cellspacing="0">
                      <tr>
                        <td style="color:#059669;font-size:14px;padding:12px 0;">免费额度</td>
                        <td style="color:#059669;font-size:16px;font-weight:700;text-align:right;padding:12px 0;">${quotaSnapshot.freeQuota} 次</td>
                      </tr>
                      <tr>
                        <td style="color:#059669;font-size:14px;padding:12px 0;">付费额度</td>
                        <td style="color:#059669;font-size:16px;font-weight:700;text-align:right;padding:12px 0;">${quotaSnapshot.paidQuota} 次</td>
                      </tr>
                      <tr>
                        <td style="color:#047857;font-size:16px;font-weight:600;padding:12px 0;">总额度</td>
                        <td style="color:#047857;font-size:20px;font-weight:700;text-align:right;padding:12px 0;">${quotaSnapshot.totalQuota} 次</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0;">
                    <a href="https://memoraid.dpdns.org/user" style="display:inline-block;background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:16px;box-shadow:0 4px 6px rgba(16,185,129,0.3);">前往内容中心</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  });

  if (!emailResult.ok) {
    const errorText = await emailResult.text();
    console.error('发送支付成功邮件失败:', emailResult.status, errorText);
  }
}

async function sendAdminRechargeNotificationEmail(
  env: Env,
  order: PaymentOrderRow,
  quotaSnapshot: UserQuotaSnapshot
): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(order.user_id).first<{ email?: string }>();
  const { emailSender, emailSenderName, notificationEmail } = await loadEmailConfig(env);
  if (!notificationEmail) return;

  // 支付自动到账后，额外给管理员发一封纯通知邮件，不再包含任何审核操作。
  const emailResult = await sendEmailViaResend(env.RESEND_API_KEY, {
    from: emailSender,
    fromName: emailSenderName,
    to: notificationEmail,
    subject: `💰 用户充值成功通知 - ${order.amount}元`,
    text:
      `有用户完成了充值并已自动到账。\n\n` +
      `用户邮箱：${user?.email || '未绑定邮箱'}\n用户 ID：${order.user_id}\n订单号：${order.id}\n` +
      `充值金额：¥${order.amount}\n增加额度：${order.quota_amount} 次\n` +
      `当前总额度：${quotaSnapshot.totalQuota} 次\n支付时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n` +
      `本邮件仅作通知，无需审核。`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:linear-gradient(135deg,#0f766e 0%,#0ea5e9 100%);padding:36px 40px 28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:30px;font-weight:700;">💰 用户充值成功</h1>
              <p style="margin:12px 0 0 0;color:rgba(255,255,255,0.95);font-size:16px;">订单已自动到账，仅作管理员通知</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 24px 0;color:#374151;font-size:16px;line-height:1.6;">有用户完成了充值，系统已自动入账。</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border-radius:12px;margin-bottom:24px;border:1px solid #e2e8f0;">
                <tr>
                  <td style="padding:24px;">
                    <h2 style="margin:0 0 16px 0;color:#111827;font-size:18px;font-weight:600;">📋 订单信息</h2>
                    <table width="100%" cellpadding="8" cellspacing="0">
                      <tr><td style="color:#6b7280;font-size:14px;padding:10px 0;">用户邮箱</td><td style="color:#111827;font-size:14px;font-weight:600;text-align:right;padding:10px 0;">${user?.email || '未绑定邮箱'}</td></tr>
                      <tr><td style="color:#6b7280;font-size:14px;padding:10px 0;">订单号</td><td style="color:#111827;font-size:14px;font-weight:600;text-align:right;padding:10px 0;">${order.id}</td></tr>
                      <tr><td style="color:#6b7280;font-size:14px;padding:10px 0;">充值金额</td><td style="color:#0f766e;font-size:16px;font-weight:700;text-align:right;padding:10px 0;">¥${order.amount}</td></tr>
                      <tr><td style="color:#6b7280;font-size:14px;padding:10px 0;">增加额度</td><td style="color:#0f766e;font-size:16px;font-weight:700;text-align:right;padding:10px 0;">+${order.quota_amount} 次</td></tr>
                      <tr><td style="color:#6b7280;font-size:14px;padding:10px 0;">当前总额度</td><td style="color:#111827;font-size:14px;font-weight:600;text-align:right;padding:10px 0;">${quotaSnapshot.totalQuota} 次</td></tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#64748b;font-size:14px;line-height:1.7;">本邮件仅作到账通知，无需任何人工审核操作。</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  });

  if (!emailResult.ok) {
    const errorText = await emailResult.text();
    console.error('发送管理员充值通知邮件失败:', emailResult.status, errorText);
  }
}

function trackPaymentAnalytics(env: Env, order: PaymentOrderRow, result: 'paid'): void {
  try {
    env.Memoraid.writeDataPoint({
      indexes: [order.user_id, 'payment', result],
      blobs: [`order_id:${order.id}`, `amount:${order.amount}`, `quota:${order.quota_amount}`],
      doubles: [Number(order.amount), Number(order.quota_amount)],
    });
  } catch (analyticsError) {
    console.error('Analytics write failed:', analyticsError);
  }
}

// 新支付链路统一写入 paid，同时兼容历史 approved 状态，避免旧订单重复入账。
async function settleRechargeOrder(
  env: Env,
  orderId: string,
  settleStatus: 'paid'
): Promise<{ order: PaymentOrderRow; quotaSnapshot: UserQuotaSnapshot; alreadySettled: boolean }> {
  const order = await env.DB.prepare('SELECT * FROM payment_orders WHERE id = ?').bind(orderId).first<PaymentOrderRow>();
  if (!order) throw new Error('订单不存在');

  if (order.status === 'paid' || order.status === 'approved') {
    return {
      order,
      quotaSnapshot: await getUserQuotaSnapshot(env, order.user_id),
      alreadySettled: true,
    };
  }

  if (order.status !== 'pending') {
    throw new Error(`订单状态不允许入账: ${order.status}`);
  }

  const paidAt = Math.floor(Date.now() / 1000);
  const updateResult = await env.DB.prepare(
    'UPDATE payment_orders SET status = ?, paid_at = ? WHERE id = ? AND status = ?'
  ).bind(settleStatus, paidAt, orderId, 'pending').run();

  const changes = Number((updateResult as any)?.meta?.changes || 0);
  if (changes === 0) {
    const latestOrder = await env.DB.prepare('SELECT * FROM payment_orders WHERE id = ?').bind(orderId).first<PaymentOrderRow>();
    if (!latestOrder) throw new Error('订单状态更新失败');

    return {
      order: latestOrder,
      quotaSnapshot: await getUserQuotaSnapshot(env, latestOrder.user_id),
      alreadySettled: latestOrder.status === 'paid' || latestOrder.status === 'approved',
    };
  }

  await env.DB.prepare(`
    INSERT INTO user_quotas (user_id, paid_quota_remaining, updated_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(user_id) DO UPDATE SET
      paid_quota_remaining = paid_quota_remaining + ?,
      updated_at = strftime('%s', 'now')
  `).bind(order.user_id, order.quota_amount, order.quota_amount).run();

  const latestOrder = await env.DB.prepare('SELECT * FROM payment_orders WHERE id = ?').bind(orderId).first<PaymentOrderRow>() || {
    ...order,
    status: settleStatus,
    paid_at: paidAt,
  };
  const quotaSnapshot = await getUserQuotaSnapshot(env, order.user_id);

  try {
    await sendRechargeSuccessEmail(env, latestOrder, quotaSnapshot);
  } catch (emailError) {
    console.error('发送支付成功邮件失败:', emailError);
  }

  try {
    await sendAdminRechargeNotificationEmail(env, latestOrder, quotaSnapshot);
  } catch (emailError) {
    console.error('发送管理员充值通知邮件失败:', emailError);
  }

  trackPaymentAnalytics(env, latestOrder, settleStatus);

  return {
    order: latestOrder,
    quotaSnapshot,
    alreadySettled: false,
  };
}

function renderMarketingShell(args: {
  origin: string;
  title: string;
  description: string;
  body: string;
}): string {
  const { origin, title, description, body } = args;
  const ASSETS_BASE = `${origin}/assets/memoraid`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="icon" type="image/png" href="${ASSETS_BASE}/icon-128.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
  <script>
    (function () {
      try {
        var token = localStorage.getItem('memoraid_token');
        if (token) document.documentElement.classList.add('authed');
      } catch (e) {}
    })();
  </script>
  <style>
    :root{
      --bg:#ffffff;
      --bg-soft:#f8fafc;
      --bg-soft-2:#f3f4f6;
      --border:#e5e7eb;
      --text:#0f172a;
      --text-2:#334155;
      --text-3:#64748b;
      --shadow:0 10px 30px rgba(2,6,23,.08);
      --shadow-sm:0 6px 16px rgba(2,6,23,.08);
      --radius:16px;
      --radius-sm:12px;
      --accent:#111827;
      --accent-2:#10b981;
      --accent-3:#a78bfa;
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{
      margin:0;
      font-family:Inter,"Noto Sans SC",system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
      color:var(--text);
      background:var(--bg);
      line-height:1.6;
    }
    a{color:inherit}
    .container{max-width:1160px;margin:0 auto;padding:0 20px}
    .top-glow{
      position:fixed;inset:0;pointer-events:none;z-index:0;
      background:
        radial-gradient(800px 400px at 30% -10%, rgba(16,185,129,.18), transparent 60%),
        radial-gradient(900px 450px at 80% 10%, rgba(167,139,250,.14), transparent 60%);
      filter:saturate(115%);
    }

    .nav{
      position:sticky;top:0;z-index:10;
      background:rgba(255,255,255,.82);
      backdrop-filter:blur(14px);
      border-bottom:1px solid var(--border);
    }
    .nav-inner{height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px}
    .brand{display:flex;align-items:center;gap:10px;text-decoration:none}
    .brand img{width:34px;height:34px;border-radius:10px}
    .brand span{font-weight:700;letter-spacing:-.02em}
    .nav-links{display:flex;align-items:center;gap:10px}
    .nav-links a{
      text-decoration:none;
      color:var(--text-3);
      font-weight:600;
      font-size:14px;
      padding:8px 10px;
      border-radius:10px;
      transition:background .15s,color .15s;
    }
    .nav-links a:hover{background:var(--bg-soft);color:var(--text)}
    .nav-actions{display:flex;align-items:center;gap:10px}
    .nav-login{
      text-decoration:none;
      color:var(--text-3);
      font-weight:700;
      font-size:14px;
      padding:8px 10px;
      border-radius:999px;
      transition:background .15s,color .15s;
    }
    .nav-login:hover{background:var(--bg-soft);color:var(--text)}
    [data-auth-admin]{display:none}
    .authed [data-auth-login]{display:none}
    .authed [data-auth-admin]{display:inline-flex}

    .btn{
      display:inline-flex;align-items:center;justify-content:center;gap:10px;
      border-radius:999px;
      padding:10px 16px;
      font-weight:700;
      font-size:14px;
      text-decoration:none;
      border:1px solid transparent;
      transition:transform .15s,box-shadow .15s,background .15s,border-color .15s;
      white-space:nowrap;
    }
    .btn:active{transform:translateY(0)}
    .btn-primary{
      background:var(--accent);
      color:#fff;
      box-shadow:0 10px 18px rgba(2,6,23,.10);
    }
    .btn-primary:hover{transform:translateY(-1px);box-shadow:0 14px 28px rgba(2,6,23,.12)}
    .btn-ghost{background:transparent;border-color:var(--border);color:var(--text)}
    .btn-ghost:hover{background:var(--bg-soft)}

    .btn-chrome{
      background:linear-gradient(180deg, #0b1220 0%, #0a0f1a 100%);
      border-color:rgba(255,255,255,.08);
      color:#fff;
      box-shadow:0 10px 18px rgba(2,6,23,.14);
      padding:10px 18px 10px 12px;
    }
    .btn-chrome:hover{transform:translateY(-1px);box-shadow:0 16px 32px rgba(2,6,23,.16)}
    .btn-icon{
      width:28px;height:28px;border-radius:999px;
      display:inline-flex;align-items:center;justify-content:center;
      background:rgba(255,255,255,.10);
      border:1px solid rgba(255,255,255,.12);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.06);
    }
    .btn-icon svg{width:18px;height:18px;display:block}
    .btn-chrome:focus-visible,
    .btn-ghost:focus-visible,
    .btn-primary:focus-visible,
    .nav-login:focus-visible,
    .nav-links a:focus-visible{
      outline:3px solid rgba(37,99,235,.35);
      outline-offset:2px;
    }

    .hero{position:relative;z-index:1;padding:78px 0 18px}
    .hero-grid{display:grid;grid-template-columns:1fr 1fr;gap:42px;align-items:center}
    .pill{
      display:inline-flex;align-items:center;gap:8px;
      padding:7px 12px;border:1px solid var(--border);border-radius:999px;
      background:rgba(248,250,252,.9);
      color:var(--text-3);
      font-weight:700;
      font-size:12px;
    }
    .hero h1{margin:16px 0 14px;font-size:clamp(34px, 4.6vw, 48px);line-height:1.08;letter-spacing:-.03em;white-space:nowrap}
    .hero p{margin:0;color:var(--text-2);font-size:16px;max-width:520px}
    .hero-actions{margin-top:22px;display:flex;gap:12px;flex-wrap:wrap}
    .hero-badges{margin-top:18px;display:flex;gap:18px;flex-wrap:wrap;color:var(--text-3);font-weight:700;font-size:12px}
    .hero-badges span{display:inline-flex;align-items:center;gap:8px}
    .badge-dot{width:8px;height:8px;border-radius:999px;background:rgba(15,23,42,.18);border:1px solid rgba(15,23,42,.14)}
    .platforms{margin-top:16px}
    .platforms-title{color:var(--text-3);font-weight:900;font-size:12px;letter-spacing:.02em}
    .platforms-list{margin-top:10px;display:flex;flex-wrap:wrap;gap:12px}
    .platform-pill{
      display:inline-flex;align-items:center;gap:10px;
      padding:10px 14px;
      border-radius:999px;
      border:1px solid var(--border);
      background:rgba(255,255,255,.72);
      box-shadow:0 8px 18px rgba(2,6,23,.06);
      color:var(--text-2);
      font-weight:800;
      font-size:13px;
      line-height:1;
    }
    .platform-mark{
      width:34px;height:34px;border-radius:999px;
      display:inline-flex;align-items:center;justify-content:center;
      border:1px solid var(--border);
      background:var(--bg-soft);
      overflow:hidden;
      flex:0 0 auto;
    }
    .platform-mark img{width:22px;height:22px;display:block}
    .platform-hint{margin-top:10px;color:var(--text-3);font-weight:700;font-size:12px}
    .hero-visual{
      border-radius:var(--radius);
      box-shadow:var(--shadow);
      overflow:hidden;
      aspect-ratio:2.5 / 1;
      background:linear-gradient(135deg,#3b82f6 0%, #6366f1 55%, #a78bfa 100%);
    }
    .hero-visual img{display:block;width:100%;height:100%;object-fit:contain;object-position:center;transform:none}
    .showcase{
      border:1px solid var(--border);
      border-radius:24px;
      background:#fff;
      box-shadow:var(--shadow);
      overflow:hidden;
    }
    .showcase-steps{padding:16px}
    .showcase-tabs{display:flex;flex-wrap:wrap;gap:10px}
    .showcase-tab{
      flex:1 1 210px;
      display:flex;
      align-items:flex-start;
      gap:10px;
      padding:12px 12px;
      border-radius:16px;
      border:1px solid var(--border);
      background:rgba(248,250,252,.75);
      box-shadow:0 10px 22px rgba(2,6,23,.06);
      cursor:pointer;
      transition:transform .15s, box-shadow .15s, background .15s, border-color .15s;
      text-align:left;
    }
    .showcase-tab:hover{transform:translateY(-1px);box-shadow:0 16px 34px rgba(2,6,23,.10);background:#fff}
    .showcase-tab[aria-selected="true"]{
      border-color:rgba(15,23,42,.16);
      background:linear-gradient(180deg, rgba(15,23,42,.06), rgba(255,255,255,.96));
      box-shadow:0 18px 40px rgba(2,6,23,.12);
    }
    .showcase-tab-n{
      width:28px;height:28px;border-radius:12px;
      display:inline-flex;align-items:center;justify-content:center;
      border:1px solid rgba(15,23,42,.10);
      background:#fff;
      color:rgba(15,23,42,.86);
      font-weight:900;
      font-size:12px;
      flex:0 0 auto;
    }
    .showcase-tab-title{margin:1px 0 2px;font-weight:900;font-size:13px;letter-spacing:-.02em}
    .showcase-tab-sub{margin:0;color:var(--text-3);font-weight:700;font-size:12px;line-height:1.45}
    .showcase-stage{position:relative;margin-top:14px}
    .showcase-frame{
      position:relative;
      border:1px solid rgba(15,23,42,.12);
      border-radius:22px;
      background:#fff;
      overflow:hidden;
      box-shadow:0 22px 55px rgba(2,6,23,.12);
      aspect-ratio:16/10;
    }
    .showcase-frame img{width:100%;height:100%;display:block;object-fit:contain;background:#fff}
    .showcase-copy{margin-top:14px;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:0 4px}
    .showcase-copy h3{margin:0;font-size:16px;letter-spacing:-.02em}
    .showcase-copy p{margin:8px 0 0;color:var(--text-2);font-weight:600;font-size:13px;line-height:1.65;max-width:720px}
    .shot-label{
      position:absolute;
      left:14px;
      bottom:14px;
      padding:8px 10px;
      border-radius:999px;
      border:1px solid rgba(255,255,255,.24);
      background:rgba(15,23,42,.65);
      color:#fff;
      font-weight:800;
      font-size:12px;
      backdrop-filter:blur(10px);
    }
    .showcase-frame .shot-label{left:16px;bottom:16px}
    .carousel-btn{
      position:absolute;
      top:50%;
      transform:translateY(-50%);
      z-index:3;
      width:44px;height:44px;
      border-radius:999px;
      border:1px solid var(--border);
      background:rgba(255,255,255,.92);
      box-shadow:0 10px 18px rgba(2,6,23,.10);
      display:flex;
      align-items:center;
      justify-content:center;
      cursor:pointer;
      transition:background .15s,box-shadow .15s,transform .15s;
    }
    .carousel-btn:hover{background:#fff;box-shadow:0 14px 28px rgba(2,6,23,.12)}
    .carousel-btn:active{transform:translateY(-50%)}
    .carousel-btn[disabled]{opacity:.4;cursor:not-allowed;box-shadow:none}
    .carousel-btn svg{width:18px;height:18px}
    .carousel-btn.prev{left:14px}
    .carousel-btn.next{right:14px}
    .flow{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
    .flow-step{
      border:1px solid var(--border);
      border-radius:24px;
      background:linear-gradient(180deg,#fff, rgba(248,250,252,.65));
      box-shadow:var(--shadow-sm);
      padding:20px;
    }
    .flow-step strong{display:block;font-size:14px;letter-spacing:-.01em}
    .flow-step div{margin-top:8px;color:var(--text-3);font-size:13px}
    .flow-chip{
      display:inline-flex;align-items:center;gap:8px;
      padding:7px 12px;border-radius:999px;
      border:1px solid var(--border);
      background:rgba(248,250,252,.9);
      color:var(--text-2);
      font-weight:900;
      font-size:12px;
    }
    .pulse{
      width:8px;height:8px;border-radius:999px;background:var(--accent-2);
      box-shadow:0 0 0 0 rgba(16,185,129,.35);
      animation:pulse 1.8s ease-out infinite;
    }
    @keyframes pulse{
      0%{box-shadow:0 0 0 0 rgba(16,185,129,.35)}
      70%{box-shadow:0 0 0 10px rgba(16,185,129,0)}
      100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}
    }
    @media (prefers-reduced-motion: reduce){
      .pulse{animation:none}
    }
    .section{position:relative;z-index:1;padding:56px 0}
    .section.soft{background:var(--bg-soft)}
    .section-head{text-align:center;margin-bottom:26px}
    .section-head h2{margin:0;font-size:28px;letter-spacing:-.02em}
    .section-head p{margin:10px auto 0;color:var(--text-3);max-width:640px}
    .grid{display:grid;gap:16px}
    .grid.features{grid-template-columns:repeat(4,1fr)}
    .card{
      border:1px solid var(--border);
      border-radius:var(--radius);
      background:#fff;
      box-shadow:var(--shadow-sm);
      padding:18px;
    }
    .card h3{margin:12px 0 6px;font-size:15px;letter-spacing:-.01em}
    .card p{margin:0;color:var(--text-3);font-size:13px}
    .thumb{
      height:124px;border-radius:14px;border:1px solid var(--border);
      overflow:hidden;
      background:#fff;
    }
    .thumb img{width:100%;height:100%;object-fit:cover;display:block}
    .logos{display:flex;gap:22px;flex-wrap:wrap;justify-content:center;color:var(--text-3);font-weight:800;font-size:12px;opacity:.85}
    .logos span{padding:8px 10px;border:1px dashed var(--border);border-radius:999px;background:rgba(255,255,255,.7)}

    .grid.usecases{grid-template-columns:repeat(3,1fr)}
    .usecase{display:flex;gap:12px;align-items:flex-start}
    .usecase .icon{
      width:40px;height:40px;border-radius:12px;border:1px solid var(--border);
      display:flex;align-items:center;justify-content:center;
      background:var(--bg-soft);
      flex:0 0 auto;
      color:rgba(15,23,42,.84);
    }
    .usecase .icon svg{width:18px;height:18px}
    .usecase h4{margin:0 0 4px;font-size:14px}
    .usecase div{color:var(--text-3);font-size:13px}

    .stats{display:flex;gap:26px;flex-wrap:wrap;justify-content:center}
    .stat{min-width:160px;text-align:center}
    .stat strong{display:block;font-size:28px;letter-spacing:-.02em}
    .stat span{display:block;color:var(--text-3);font-weight:700;font-size:12px;margin-top:6px}

    .cta{
      border:1px solid var(--border);
      background:linear-gradient(135deg, rgba(16,185,129,.10), rgba(167,139,250,.12));
      border-radius:24px;
      padding:34px 22px;
      text-align:center;
      box-shadow:var(--shadow);
    }
    .cta h3{margin:0;font-size:24px;letter-spacing:-.02em}
    .cta p{margin:10px auto 0;color:var(--text-2);max-width:680px}
    .cta .hero-actions{justify-content:center}

    .footer{position:relative;z-index:1;border-top:1px solid var(--border);padding:36px 0;background:#fff}
    .footer-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:18px}
    .footer p{margin:0;color:var(--text-3);font-size:13px}
    .footer h5{margin:0 0 10px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)}
    .footer a{display:block;text-decoration:none;color:var(--text-2);font-weight:700;font-size:13px;padding:7px 0}
    .footer a:hover{text-decoration:underline}

    @media (max-width: 980px){
      .hero-grid{grid-template-columns:1fr;gap:18px}
      .hero h1{font-size:clamp(32px, 6vw, 40px);white-space:normal}
      .grid.features{grid-template-columns:repeat(2,1fr)}
      .grid.usecases{grid-template-columns:1fr}
      .flow{grid-template-columns:1fr}
      .footer-grid{grid-template-columns:1fr 1fr}
      .nav-links{display:none}
      .showcase-copy{flex-direction:column}
    }
    @media (max-width: 520px){
      .grid.features{grid-template-columns:1fr}
      .footer-grid{grid-template-columns:1fr}
      .hero{padding-top:56px}
      .hero h1{font-size:34px}
    }
  </style>
</head>
<body>
  <div class="top-glow"></div>
  ${body}
  <script>
    (function () {
      try {
        const token = localStorage.getItem('memoraid_token');
        if (!token) {
          document.documentElement.classList.remove('authed');
          return;
        }
        fetch('/api/auth/verify', { headers: { Authorization: 'Bearer ' + token } })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (payload) {
            if (!payload || !payload.ok || !payload.data || !payload.data.authenticated) {
              document.documentElement.classList.remove('authed');
              return;
            }
            document.documentElement.classList.add('authed');
          })
          .catch(function () {});
      } catch (e) {}
    })();
  </script>
</body>
</html>`;
}

function renderMarketingNav(origin: string): string {
  const ASSETS_BASE = `${origin}/assets/memoraid`;
  const chromeIcon = renderChromeIconSvg();
  return `<header class="nav">
  <div class="container">
    <div class="nav-inner">
      <a class="brand" href="/">
        <img src="${ASSETS_BASE}/icon-128.png" alt="Memoraid">
        <span>Memoraid</span>
      </a>
      <nav class="nav-links" aria-label="主导航">
        <a href="/#showcase">展示</a>
        <a href="/#flow">流程</a>
        <a href="/#features">功能</a>
        <a href="/#usecases">场景</a>
        <a href="/pricing">定价</a>
      </nav>
      <div class="nav-actions">
        <a class="nav-login" href="/login" data-auth-login>登录</a>
        <a class="nav-login" href="/user" data-auth-admin>进入后台</a>
        <a class="btn btn-chrome" href="https://chromewebstore.google.com/detail/memoraid/leonoilddlplhmmahjmnendflfnlnlmg" target="_blank" rel="noreferrer" aria-label="免费添加到 Chrome（新标签页打开）">
          <span class="btn-icon">${chromeIcon}</span>
          <span>免费添加到 Chrome</span>
        </a>
      </div>
    </div>
  </div>
</header>`;
}

function renderChromeIconSvg(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path fill="#EA4335" d="M12 2a10 10 0 0 1 8.66 5H12a5 5 0 0 0-4.33 2.5L4.2 4.2A10 10 0 0 1 12 2z"/>
  <path fill="#FBBC05" d="M3.34 6.1A10 10 0 0 0 12 22c1.9 0 3.68-.53 5.2-1.44L12 14.5a5 5 0 0 1-4.33-2.5L3.34 6.1z"/>
  <path fill="#34A853" d="M20.66 7A10 10 0 0 1 12 22l5.2-9.02A5 5 0 0 0 12 7h8.66z"/>
  <circle cx="12" cy="12" r="3.6" fill="#4285F4"/>
  <circle cx="12" cy="12" r="2" fill="#E8F0FE"/>
</svg>`;
}

function renderMarketingFooter(origin: string): string {
  const year = new Date().getFullYear();
  const ASSETS_BASE = `${origin}/assets/memoraid`;
  return `<footer class="footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <a class="brand" href="/" style="margin-bottom:10px">
          <img src="${ASSETS_BASE}/icon-128.png" alt="Memoraid">
          <span>Memoraid</span>
        </a>
        <p>© ${year} Memoraid. All rights reserved.</p>
      </div>
      <div>
        <h5>产品</h5>
        <a href="/">官网首页</a>
        <a href="/pricing">定价</a>
      </div>
      <div>
        <h5>资源</h5>
        <a href="/privacy">隐私政策</a>
      </div>
      <div>
        <h5>入口</h5>
        <a href="/login">登录</a>
        <a href="/user">管理后台</a>
      </div>
    </div>
  </div>
</footer>`;
}

function renderMarketingHome(origin: string): string {
  const ASSETS_BASE = `${origin}/assets/memoraid`;
  const nav = renderMarketingNav(origin);
  const footer = renderMarketingFooter(origin);
  const chromeIcon = renderChromeIconSvg();

  const body = `${nav}
<main class="hero">
  <div class="container">
    <div class="hero-grid">
      <div>
        <div class="pill">AI 自媒体运营插件 · 全流程自动化</div>
        <h1>自动选题 · 自动生成 · 自动发布</h1>
        <p>Memoraid 是一款专为自媒体运营打造的浏览器插件：自动化选择热门话题、AI 智能生成优质文章、一键发布到小红书、公众号、知乎等多个平台。让你的自媒体账号 24 小时不间断运营。</p>
        <div class="hero-actions">
          <a class="btn btn-chrome" href="https://chromewebstore.google.com/detail/memoraid/leonoilddlplhmmahjmnendflfnlnlmg" target="_blank" rel="noreferrer">
            <span class="btn-icon">${chromeIcon}</span>
            <span>免费添加到 Chrome</span>
          </a>
          <a class="btn btn-ghost" href="/pricing">查看定价</a>
        </div>
        <div class="hero-badges">
          <span><span class="badge-dot"></span>定时任务自动选择热门话题</span>
          <span><span class="badge-dot"></span>AI 智能生成优质文章</span>
          <span><span class="badge-dot"></span>一键发布到多个自媒体平台</span>
        </div>
        <div class="platforms" aria-label="支持发布平台">
          <div class="platforms-title">支持发布平台</div>
          <div class="platforms-list">
            <div class="platform-pill"><span class="platform-mark"><img alt="微信公众号" src="https://cdn.simpleicons.org/wechat/07C160" loading="lazy" decoding="async"></span><span>公众号</span></div>
            <div class="platform-pill"><span class="platform-mark"><img alt="今日头条" src="https://www.toutiao.com/favicon.ico" referrerpolicy="no-referrer" loading="lazy" decoding="async"></span><span>头条</span></div>
            <div class="platform-pill"><span class="platform-mark"><img alt="知乎" src="https://cdn.simpleicons.org/zhihu/0084FF" loading="lazy" decoding="async"></span><span>知乎</span></div>
            <div class="platform-pill"><span class="platform-mark"><img alt="虎扑" src="https://bbs.hupu.com/favicon.ico" referrerpolicy="no-referrer" loading="lazy" decoding="async"></span><span>虎扑</span></div>
            <div class="platform-pill"><span class="platform-mark"><img alt="百度贴吧" src="https://tieba.baidu.com/favicon.ico" referrerpolicy="no-referrer" loading="lazy" decoding="async"></span><span>贴吧</span></div>
            <div class="platform-pill"><span class="platform-mark"><img alt="哔哩哔哩" src="https://cdn.simpleicons.org/bilibili/00A1D6" loading="lazy" decoding="async"></span><span>B 站</span></div>
            <div class="platform-pill"><span class="platform-mark"><img alt="掘金" src="https://cdn.simpleicons.org/juejin/1E80FF" loading="lazy" decoding="async"></span><span>掘金</span></div>
            <div class="platform-pill"><span class="platform-mark"><img alt="CSDN" src="https://cdn.simpleicons.org/csdn/FC5531" loading="lazy" decoding="async"></span><span>CSDN</span></div>
            <div class="platform-pill"><span class="platform-mark"><img alt="小红书" src="https://cdn.simpleicons.org/xiaohongshu/FF2442" loading="lazy" decoding="async"></span><span>小红书</span></div>
            <div class="platform-pill"><span class="platform-mark"><img alt="快手" src="https://cdn.simpleicons.org/kuaishou/FF4906" loading="lazy" decoding="async"></span><span>快手</span></div>
            <div class="platform-pill"><span class="platform-mark"><img alt="抖音" src="https://cdn.simpleicons.org/tiktok/000000" loading="lazy" decoding="async"></span><span>抖音</span></div>
            <div class="platform-pill"><span class="platform-mark"><img alt="微博" src="https://cdn.simpleicons.org/sinaweibo/E6162D" loading="lazy" decoding="async"></span><span>微博</span></div>
          </div>
          <div class="platform-hint">更多平台持续接入中</div>
        </div>
      </div>
      <div class="hero-visual" aria-label="产品预览">
        <img src="${ASSETS_BASE}/promo-marquee-1400x560.png?v=20260114d" alt="Memoraid 产品展示" onerror="this.onerror=null;this.src='${ASSETS_BASE}/screenshot-10.png?v=20260114d'">
      </div>
    </div>
  </div>
</main>

<section class="section soft">
  <div class="container">
    <div class="section-head">
      <h2>适合每天都在网上工作的人</h2>
      <p>不论你是在看资料、写内容、做调研还是处理信息流，都能把 AI 直接带到当前页面。</p>
    </div>
    <div class="logos" aria-label="信任标识">
      <span>Google</span><span>Meta</span><span>PayPal</span><span>Walmart</span><span>Stanford</span><span>MIT</span><span>清华</span><span>北大</span>
    </div>
  </div>
</section>

<section class="section soft">
  <div class="container">
    <div class="section-head">
      <h2>真实运营效果</h2>
      <p>使用 Memoraid 自动化运营的真实数据</p>
    </div>
    <div style="max-width:900px;margin:0 auto">
      <div style="margin-bottom:48px">
        <div style="text-align:center;margin-bottom:16px">
          <h3 style="margin:0 0 8px;font-size:24px;color:var(--text)">📱 小红书运营一周</h3>
          <p style="margin:0;font-size:18px;color:#10b981;font-weight:600">200万+ 曝光 · 60万+ 阅读</p>
        </div>
        <img src="${ASSETS_BASE}/xiaohongshu-result.png" alt="小红书运营一周效果" style="width:100%;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);cursor:pointer" onclick="openImageModal(this.src)">
      </div>
      <div>
        <div style="text-align:center;margin-bottom:16px">
          <h3 style="margin:0 0 8px;font-size:24px;color:var(--text)">💰 公众号运营效果</h3>
          <p style="margin:0;font-size:18px;color:#10b981;font-weight:600">每篇文章都有广告收入，实现睡后收入</p>
        </div>
        <img src="${ASSETS_BASE}/weixin-result.png" alt="公众号运营效果" style="width:100%;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);cursor:pointer" onclick="openImageModal(this.src)">
      </div>
    </div>
  </div>
</section>

<!-- 图片放大查看的lightbox -->
<div id="imageLightbox" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:9999;align-items:center;justify-content:center;padding:20px" onclick="closeImageModal()">
  <img id="lightboxImage" src="" style="max-width:90%;max-height:90%;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5)">
  <div style="position:absolute;top:20px;right:20px;color:#fff;font-size:32px;cursor:pointer;width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.1);border-radius:50%;backdrop-filter:blur(10px)" onclick="closeImageModal()">×</div>
</div>

<script>
function openImageModal(src) {
  const lightbox = document.getElementById('imageLightbox');
  const img = document.getElementById('lightboxImage');
  img.src = src;
  lightbox.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeImageModal() {
  const lightbox = document.getElementById('imageLightbox');
  lightbox.style.display = 'none';
  document.body.style.overflow = '';
}

// ESC键关闭
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeImageModal();
  }
});
</script>

<section class="section" id="showcase">
  <div class="container">
    <div class="section-head">
      <h2>页面里完成一整套工作</h2>
      <p>提炼 → 成稿 → 发布 → 复盘，每一步都有对应界面。</p>
    </div>
    <div class="showcase showcase-steps" data-showcase>
      <div class="showcase-tabs" role="tablist" aria-label="工作流程步骤">
        <button class="showcase-tab" type="button" data-showcase-step="0" aria-selected="true"
          data-src="${ASSETS_BASE}/screenshot-11.png"
          data-alt="网页/对话一键提炼"
          data-label="Step 01 · 提炼"
          data-title="网页/对话一键提炼"
          data-desc="自动抓取关键段落、引用与结构，把零散信息整理成可复用素材。">
          <span class="showcase-tab-n">01</span>
          <span>
            <div class="showcase-tab-title">网页/对话一键提炼</div>
            <div class="showcase-tab-sub">抓取要点与引用，形成素材库</div>
          </span>
        </button>
        <button class="showcase-tab" type="button" data-showcase-step="1" aria-selected="false"
          data-src="${ASSETS_BASE}/screenshot-12.png"
          data-alt="按结构生成成稿"
          data-label="Step 02 · 成稿"
          data-title="按结构生成成稿"
          data-desc="标题、提纲、分段、语气与风格可控，适配各平台的表达习惯。">
          <span class="showcase-tab-n">02</span>
          <span>
            <div class="showcase-tab-title">按结构生成成稿</div>
            <div class="showcase-tab-sub">提纲分段、语气风格可控</div>
          </span>
        </button>
        <button class="showcase-tab" type="button" data-showcase-step="2" aria-selected="false"
          data-src="${ASSETS_BASE}/screenshot-13.png"
          data-alt="一键发布到多平台"
          data-label="Step 03 · 发布"
          data-title="一键发布到多平台"
          data-desc="自动填充标题与正文，处理配图与封面，减少排版与来回切换。">
          <span class="showcase-tab-n">03</span>
          <span>
            <div class="showcase-tab-title">一键发布到多平台</div>
            <div class="showcase-tab-sub">自动填充、排版、封面配图</div>
          </span>
        </button>
        <button class="showcase-tab" type="button" data-showcase-step="3" aria-selected="false"
          data-src="${ASSETS_BASE}/screenshot-14.png"
          data-alt="发布后复盘与沉淀"
          data-label="Step 04 · 复盘"
          data-title="发布后复盘与沉淀"
          data-desc="在后台集中查看文章记录与表现，持续优化选题与写作套路。">
          <span class="showcase-tab-n">04</span>
          <span>
            <div class="showcase-tab-title">发布后复盘与沉淀</div>
            <div class="showcase-tab-sub">数据回看，形成可复用方法</div>
          </span>
        </button>
      </div>

      <div class="showcase-stage" aria-label="步骤截图展示">
        <button class="carousel-btn prev" type="button" aria-label="上一张" data-showcase-prev disabled>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="showcase-frame">
          <img data-showcase-image src="${ASSETS_BASE}/screenshot-11.png" alt="网页/对话一键提炼" loading="lazy" decoding="async">
          <div class="shot-label" data-showcase-label>Step 01 · 提炼</div>
        </div>
        <button class="carousel-btn next" type="button" aria-label="下一张" data-showcase-next>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <div class="showcase-copy">
        <div>
          <h3 data-showcase-title>网页/对话一键提炼</h3>
          <p data-showcase-desc>自动抓取关键段落、引用与结构，把零散信息整理成可复用素材。</p>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section soft" id="flow">
  <div class="container">
    <div class="section-head">
      <h2>三步完成自动化</h2>
      <p>从信息获取到发布，尽量不打断你的节奏。</p>
    </div>
    <div class="flow">
      <div class="flow-step">
        <div class="flow-chip"><span class="pulse"></span>1. 抓取素材</div>
        <strong style="margin-top:12px">网页/对话/链接一键整理</strong>
        <div>自动提取关键内容、引用与结构，减少手动复制粘贴。</div>
      </div>
      <div class="flow-step">
        <div class="flow-chip"><span class="pulse"></span>2. 生成成稿</div>
        <strong style="margin-top:12px">可控的结构与风格</strong>
        <div>标题、提纲、分段、降重、润色，适配不同平台的表达习惯。</div>
      </div>
      <div class="flow-step">
        <div class="flow-chip"><span class="pulse"></span>3. 一键发布</div>
        <strong style="margin-top:12px">头条/知乎/公众号自动化</strong>
        <div>自动排版与发布；配图上传到 R2，稳定可复用。</div>
      </div>
    </div>
  </div>
</section>

<section class="section" id="features">
  <div class="container">
    <div class="section-head">
      <h2>主要功能</h2>
      <p>围绕自媒体高频动作：提炼、生成、发布、复盘。</p>
    </div>
    <div class="grid features">
      <div class="card">
        <div class="thumb" aria-hidden="true"><img src="${ASSETS_BASE}/feature-extract.png?v=20260114f" alt="" loading="lazy" decoding="async"></div>
        <h3>网页总结与要点提取</h3>
        <p>快速抓住文章、对话或页面的核心观点，适合做笔记与资料整理。</p>
      </div>
      <div class="card">
        <div class="thumb" aria-hidden="true"><img src="${ASSETS_BASE}/feature-rewrite.png?v=20260114f" alt="" loading="lazy" decoding="async"></div>
        <h3>写作润色与改写</h3>
        <p>生成标题、扩写段落、降重改写，用更少时间产出更好的内容。</p>
      </div>
      <div class="card">
        <div class="thumb" aria-hidden="true"><img src="${ASSETS_BASE}/feature-organize.png?v=20260114f" alt="" loading="lazy" decoding="async"></div>
        <h3>对比与整理资料</h3>
        <p>把零散信息结构化，形成可复用的结论与模板，支持后续复盘。</p>
      </div>
      <div class="card">
        <div class="thumb" aria-hidden="true"><img src="${ASSETS_BASE}/feature-publish.png?v=20260114f" alt="" loading="lazy" decoding="async"></div>
        <h3>自动发布到自媒体平台</h3>
        <p>支持头条号、知乎专栏、微信公众号：减少重复排版与来回切换。</p>
      </div>
      <div class="card">
        <div class="thumb" aria-hidden="true"><img src="${ASSETS_BASE}/feature-privacy.png?v=20260114f" alt="" loading="lazy" decoding="async"></div>
        <h3>隐私优先</h3>
        <p>设置与偏好使用客户端加密同步，服务器仅存储密文。</p>
      </div>
      <div class="card">
        <div class="thumb" aria-hidden="true"><img src="${ASSETS_BASE}/feature-instant.png?v=20260114f" alt="" loading="lazy" decoding="async"></div>
        <h3>轻量、即开即用</h3>
        <p>不改变你的工作习惯，把 AI 贴合在“正在看的那一页”。</p>
      </div>
      <div class="card">
        <div class="thumb" aria-hidden="true"><img src="${ASSETS_BASE}/feature-analytics.png?v=20260114f" alt="" loading="lazy" decoding="async"></div>
        <h3>内容表现回看</h3>
        <p>可在后台查看文章数据与趋势，方便复盘与策略调整。</p>
      </div>
      <div class="card">
        <div class="thumb" aria-hidden="true"><img src="${ASSETS_BASE}/feature-assets.png?v=20260114f" alt="" loading="lazy" decoding="async"></div>
        <h3>智能配图与素材复用</h3>
        <p>文章配图上传到 R2 统一管理，稳定链接、方便二次创作。</p>
      </div>
    </div>
  </div>
</section>

<section class="section soft" id="usecases">
  <div class="container">
    <div class="section-head">
      <h2>使用场景</h2>
      <p>把“网页内容”变成“可用的产出”：文章、提纲、总结、脚本、发布素材。</p>
    </div>
    <div class="grid usecases">
      <div class="card usecase">
        <div class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 3h7l3 3v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M9 11h6M9 15h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <h4>阅读长文</h4>
          <div>提取摘要、结论、关键论据，快速做笔记。</div>
        </div>
      </div>
      <div class="card usecase">
        <div class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M4 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" stroke="currentColor" stroke-width="1.8"/>
            <path d="M16 10l4-2v8l-4-2v-4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h4>内容复盘</h4>
          <div>整理信息源与观点，对比不同资料的差异。</div>
        </div>
      </div>
      <div class="card usecase">
        <div class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M8 8h3a2 2 0 1 0 0-4h5v5a2 2 0 1 1-4 0V8H8v4a2 2 0 1 1 0 4H4v-5a2 2 0 1 0 4 0V8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h4>写作与发布</h4>
          <div>从素材到成稿，生成标题与结构，减少卡壳。</div>
        </div>
      </div>
      <div class="card usecase">
        <div class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 0-2 2V4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M6 20h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <h4>学习新领域</h4>
          <div>把复杂概念解释成更容易理解的版本。</div>
        </div>
      </div>
      <div class="card usecase">
        <div class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M3 11v2a2 2 0 0 0 2 2h2l5 4V5L7 9H5a2 2 0 0 0-2 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M16 8a4 4 0 0 1 0 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <h4>营销文案</h4>
          <div>生成卖点、对比表、FAQ，快速出多版本文案。</div>
        </div>
      </div>
      <div class="card usecase">
        <div class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M8.5 20c-2.2 0-4-1.8-4-4V9.5C4.5 6.5 7 4 10 4c1.4 0 2.8.6 3.8 1.6A4.8 4.8 0 0 1 16.5 5c2.2 0 4 1.8 4 4v6c0 2.8-2.2 5-5 5H8.5z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M8.5 14c.6.7 1.5 1.2 2.5 1.2 1 0 1.9-.5 2.5-1.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h4>灵感与头脑风暴</h4>
          <div>在页面里直接提问，持续推进你的想法。</div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="section-head">
      <h2>为什么是 Memoraid</h2>
      <p>追求“在网页里更顺手地用 AI”，把高频路径做到极简。</p>
    </div>
    <div class="stats" aria-label="数据指标">
      <div class="stat"><strong>4.9★</strong><span>用户评分</span></div>
      <div class="stat"><strong>40+</strong><span>每月节省小时</span></div>
      <div class="stat"><strong>100%</strong><span>隐私优先设计</span></div>
      <div class="stat"><strong>5x</strong><span>更快的资料整理</span></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="cta">
      <h3>把 AI 直接放进你的工作页面</h3>
      <p>无需切换 Tab、无需复制粘贴，边看边问，边写边改，一步到位。</p>
      <div class="hero-actions">
        <a class="btn btn-chrome" href="https://chromewebstore.google.com/detail/memoraid/leonoilddlplhmmahjmnendflfnlnlmg" target="_blank" rel="noreferrer">
          <span class="btn-icon">${chromeIcon}</span>
          <span>免费添加到 Chrome</span>
        </a>
        <a class="btn btn-ghost" href="/pricing">查看定价</a>
      </div>
    </div>
  </div>
</section>
<script>
  (function () {
    const root = document.querySelector('[data-showcase]');
    if (!root) return;
    const tabs = Array.from(root.querySelectorAll('.showcase-tab'));
    const img = root.querySelector('[data-showcase-image]');
    const label = root.querySelector('[data-showcase-label]');
    const title = root.querySelector('[data-showcase-title]');
    const desc = root.querySelector('[data-showcase-desc]');
    const prev = root.querySelector('[data-showcase-prev]');
    const next = root.querySelector('[data-showcase-next]');

    if (!tabs.length || !img) return;
    let current = 0;

    function clamp(n) {
      return Math.max(0, Math.min(tabs.length - 1, n));
    }

    function readTab(i) {
      const el = tabs[i];
      return {
        el: el,
        src: el.getAttribute('data-src') || '',
        alt: el.getAttribute('data-alt') || '',
        label: el.getAttribute('data-label') || '',
        title: el.getAttribute('data-title') || '',
        desc: el.getAttribute('data-desc') || ''
      };
    }

    function preload(src) {
      if (!src) return;
      const im = new Image();
      im.decoding = 'async';
      im.loading = 'eager';
      im.src = src;
    }

    function applyStep(idx, shouldFocus) {
      const nextIdx = clamp(idx);
      current = nextIdx;
      for (let i = 0; i < tabs.length; i++) {
        tabs[i].setAttribute('aria-selected', i === current ? 'true' : 'false');
      }
      const d = readTab(current);
      if (d.src) img.setAttribute('src', d.src);
      img.setAttribute('alt', d.alt || d.title || '步骤截图');
      if (label) label.textContent = d.label || '';
      if (title) title.textContent = d.title || '';
      if (desc) desc.textContent = d.desc || '';
      if (prev) prev.disabled = current === 0;
      if (next) next.disabled = current === tabs.length - 1;
      const p = readTab(clamp(current - 1)).src;
      const n = readTab(clamp(current + 1)).src;
      preload(p);
      preload(n);
      if (shouldFocus) tabs[current].focus();
    }

    for (let i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        const raw = tabs[i].getAttribute('data-showcase-step') || '';
        const idx = Number(raw);
        if (!Number.isFinite(idx)) return;
        applyStep(idx, false);
      });
    }
    if (prev) prev.addEventListener('click', function () { applyStep(current - 1, false); });
    if (next) next.addEventListener('click', function () { applyStep(current + 1, false); });

    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') applyStep(current - 1, false);
      if (e.key === 'ArrowRight') applyStep(current + 1, false);
    });

    applyStep(0, false);
  })();
</script>
${footer}`;

  return renderMarketingShell({
    origin,
    title: 'Memoraid - AI 自动化自媒体写作与一键发布',
    description:
      'Memoraid 是一款浏览器扩展：提炼素材、生成自媒体文章，并自动发布到头条号、知乎专栏、微信公众号；配图可上传到 R2 统一管理。',
    body,
  });
}

function renderMarketingPricing(origin: string): string {
  const nav = renderMarketingNav(origin);
  const footer = renderMarketingFooter(origin);
  const ASSETS_BASE = `${origin}/assets/memoraid`;

  const body = `${nav}
<main class="hero">
  <div class="container">
    <div class="section-head" style="margin-bottom:18px">
      <h2 style="font-size:34px;margin:0;letter-spacing:-.03em">按需充值 · 灵活使用</h2>
      <p style="margin-top:10px">按额度充值，用多少充多少。无需订阅，永久有效。</p>
    </div>

    <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:16px">
      <div class="card">
        <div class="pill" style="display:inline-flex">体验套餐</div>
        <h3 style="margin:12px 0 6px;font-size:22px">¥9.9</h3>
        <p style="margin:0 0 14px;color:var(--text-3)">30 额度 · 适合新手体验</p>
        <a class="btn btn-ghost" href="/user" rel="noreferrer">立即充值</a>
        <div style="height:14px"></div>
        <div style="color:var(--text-2);font-weight:800;font-size:13px;margin-bottom:8px">包含</div>
        <div style="color:var(--text-3);font-size:13px">
          <div>• 30 额度（可生成 30 篇文章）</div>
          <div>• 支持所有平台发布</div>
          <div>• 永久有效，用完再充</div>
        </div>
      </div>

      <div class="card" style="border-color:rgba(16,185,129,.40);background:linear-gradient(180deg,#fff, rgba(16,185,129,.05))">
        <div class="pill" style="display:inline-flex;border-color:rgba(16,185,129,.35);background:rgba(16,185,129,.08);color:var(--text)">推荐</div>
        <h3 style="margin:12px 0 6px;font-size:22px">¥29.9<span style="font-size:13px;color:var(--text-3);font-weight:800"></span></h3>
        <p style="margin:0 0 14px;color:var(--text-3)">100 额度 · 高性价比</p>
        <a class="btn btn-primary" href="/user" rel="noreferrer">立即充值</a>
        <div style="height:14px"></div>
        <div style="color:var(--text-2);font-weight:800;font-size:13px;margin-bottom:8px">包含</div>
        <div style="color:var(--text-3);font-size:13px">
          <div>• 100 额度（可生成 100 篇文章）</div>
          <div>• 支持定时任务自动运营</div>
          <div>• 永久有效，用完再充</div>
        </div>
      </div>

      <div class="card">
        <div class="pill" style="display:inline-flex">超值套餐</div>
        <h3 style="margin:12px 0 6px;font-size:22px">¥49.9</h3>
        <p style="margin:0 0 14px;color:var(--text-3)">200 额度 · 大量优惠</p>
        <a class="btn btn-ghost" href="/user">立即充值</a>
        <div style="height:14px"></div>
        <div style="color:var(--text-2);font-weight:800;font-size:13px;margin-bottom:8px">包含</div>
        <div style="color:var(--text-3);font-size:13px">
          <div>• 200 额度（可生成 200 篇文章）</div>
          <div>• 支持定时任务自动运营</div>
          <div>• 永久有效，用完再充</div>
        </div>
      </div>
    </div>
    
    <div style="margin-top:24px;padding:16px;background:rgba(59,130,246,.05);border:1px solid rgba(59,130,246,.2);border-radius:12px;text-align:center">
      <p style="margin:0;color:var(--text-2);font-size:14px">💡 <strong>大量额度购买</strong>：如需购买 500 额度以上，请<a href="/user#recharge" style="color:#3b82f6;text-decoration:none;margin-left:4px">联系客服</a>获取优惠价格</p>
    </div>
  </div>
</main>
  document.body.style.overflow = 'hidden';
}

function closeImageModal() {
  const lightbox = document.getElementById('imageLightbox');
  lightbox.style.display = 'none';
  document.body.style.overflow = '';
}

// ESC键关闭
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeImageModal();
  }
});
</script>

<section class="section">
  <div class="container">
    <div class="section-head">
      <h2>常见问题</h2>
      <p>下面是最常见的问题与答案。</p>
    </div>
    <div class="grid" style="grid-template-columns:repeat(2,1fr);gap:16px">
      <div class="card">
        <h3 style="margin:0 0 8px;font-size:14px">额度如何计算？</h3>
        <p style="margin:0;color:var(--text-3)">1 额度 = 1 篇文章。充值 30 额度可以生成 30 篇文章，充值 100 额度可以生成 100 篇文章。</p>
      </div>
      <div class="card">
        <h3 style="margin:0 0 8px;font-size:14px">额度会过期吗？</h3>
        <p style="margin:0;color:var(--text-3)">不会。充值的额度永久有效，用完再充，没有时间限制。</p>
      </div>
      <div class="card">
        <h3 style="margin:0 0 8px;font-size:14px">可以开发票吗？</h3>
        <p style="margin:0;color:var(--text-3)">可以。购买企业套餐（199元及以上）可以开具增值税普通发票，联系客服提供开票信息。</p>
      </div>
      <div class="card">
        <h3 style="margin:0 0 8px;font-size:14px">支持哪些支付方式？</h3>
        <p style="margin:0;color:var(--text-3)">目前支持支付宝、微信支付。企业套餐支持对公转账。</p>
      </div>
    </div>

    <div style="height:18px"></div>
    <div class="cta">
      <h3>现在就开始</h3>
      <p>先安装插件体验，觉得好用再充值。</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="https://chromewebstore.google.com/detail/memoraid/leonoilddlplhmmahjmnendflfnlnlmg" target="_blank" rel="noreferrer">免费安装插件</a>
        <a class="btn btn-ghost" href="/">返回首页</a>
      </div>
    </div>
  </div>
</section>
${footer}`;

  return renderMarketingShell({
    origin,
    title: 'Memoraid 定价 - 按需充值，灵活使用',
    description: 'Memoraid 按额度充值，无需订阅。体验套餐 9.9 元起，大量充值享受优惠。',
    body,
  });
}

function renderMarketingLogin(origin: string, error?: string | null): string {
  const nav = renderMarketingNav(origin);
  const footer = renderMarketingFooter(origin);

  const errorText =
    error === 'auth_failed'
      ? '登录失败，请重试。'
      : error === 'oauth_not_configured'
        ? 'OAuth 未配置，请先完成配置。'
        : '';

  const body = `${nav}
<main class="hero">
  <div class="container">
    <div style="max-width:420px;margin:0 auto">
      <div class="card" style="padding:22px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:12px;border:1px solid var(--border);background:var(--bg-soft);font-weight:900">M</span>
          <div style="font-weight:900;letter-spacing:-.02em">Memoraid</div>
        </div>
        <div style="font-size:22px;font-weight:900;letter-spacing:-.03em;margin:10px 0 6px">欢迎回来</div>
        <div style="color:var(--text-3);font-weight:700;font-size:13px;margin-bottom:16px">登录以访问管理后台</div>

        ${errorText ? `<div style="margin-bottom:14px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.06);padding:10px 12px;border-radius:14px;color:#b91c1c;font-weight:800;font-size:13px">${errorText}</div>` : ''}

        <div id="loginButtons" style="display:flex;flex-direction:column;gap:10px">
          <button type="button" class="btn btn-primary" style="width:100%;border-radius:14px" onclick="loginWith('google')">
            使用 Google 登录
          </button>
          <button type="button" class="btn btn-ghost" style="width:100%;border-radius:14px" onclick="loginWith('github')">
            使用 GitHub 登录
          </button>
        </div>

        <div style="display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--text-3);font-weight:800;font-size:12px">
          <span style="height:1px;background:var(--border);flex:1"></span>
          或
          <span style="height:1px;background:var(--border);flex:1"></span>
        </div>

        <a class="btn btn-ghost" href="/" style="width:100%;border-radius:14px">返回首页</a>

        <div style="margin-top:14px;color:var(--text-3);font-weight:700;font-size:12px">
          登录即表示您同意我们的 <a href="/privacy" style="font-weight:900">隐私政策</a>
        </div>
      </div>
    </div>
  </div>

  <script>
    function loginWith(provider) {
      const buttons = document.getElementById('loginButtons');
      if (buttons) buttons.style.opacity = '0.7';
      const redirectUri = encodeURIComponent(window.location.origin + '/auth/web-callback');
      window.location.href = '/auth/login/' + provider + '?redirect_uri=' + redirectUri;
    }
  </script>
</main>
${footer}`;

  return renderMarketingShell({
    origin,
    title: '登录 - Memoraid',
    description: '登录以访问 Memoraid 管理后台。',
    body,
  });
}

function getUserIdFromRequest(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return null;
  
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  if (!token.startsWith('mock_jwt_')) return null;
  
  try {
    const tokenPart = token.split('mock_jwt_')[1];
    const payload = JSON.parse(atob(tokenPart));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload.userId;
  } catch (e) {
    return null;
  }
}

// 验证系统管理员权限（检查token的role字段）
function verifyAdminToken(request: Request): { valid: boolean; error?: string } {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return { valid: false, error: 'Unauthorized' };
  }
  
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  if (!token.startsWith('mock_jwt_')) {
    return { valid: false, error: 'Unauthorized' };
  }
  
  try {
    const tokenPart = token.split('mock_jwt_')[1];
    const payload = JSON.parse(atob(tokenPart));
    
    if (payload.exp && payload.exp < Date.now()) {
      return { valid: false, error: 'Token expired' };
    }
    
    if (payload.role !== 'system_admin') {
      return { valid: false, error: 'Forbidden' };
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, error: 'Invalid token' };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const effectiveOrigin = getEffectiveOrigin(request, url);

    if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return Response.redirect(`https://${url.host}${url.pathname}${url.search}`, 308);
    }
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Anonymous-ID, X-Client-Id',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Google Search Console 验证文件
    if (url.pathname === '/google3630936db0327b0d.html' && request.method === 'GET') {
      return new Response('google-site-verification: google3630936db0327b0d.html', {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // R2 静态资源访问 - /assets/*
    if (url.pathname.startsWith('/assets/') && request.method === 'GET') {
      const key = url.pathname.replace('/assets/', '');
      try {
        const object = await env.R2.get(key);
        if (!object) {
          return new Response('Not Found', { status: 404 });
        }
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('Cache-Control', 'public, max-age=31536000');
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(object.body, { headers });
      } catch (e) {
        return new Response('Error fetching asset', { status: 500 });
      }
    }

    // R2 图片上传 (需要认证，仅管理员使用)
    if (url.pathname === '/api/upload' && request.method === 'POST') {
      try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const filename = formData.get('filename') as string || file.name;
        
        if (!file) {
          return new Response(JSON.stringify({ error: 'No file provided' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        const key = 'memoraid/' + filename;
        await env.R2.put(key, file.stream(), {
          httpMetadata: { contentType: file.type }
        });
        
        return new Response(JSON.stringify({ 
          success: true, 
          url: effectiveOrigin + '/assets/' + key 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // R2 图片代理上传（从 URL 下载并上传到 R2）
    if (url.pathname === '/api/upload-from-url' && request.method === 'POST') {
      try {
        const body = await request.json();
        const imageUrl = body.url;
        
        if (!imageUrl) {
          return new Response(JSON.stringify({ error: 'No URL provided' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        console.log(`[R2 Proxy] Downloading image from: ${imageUrl}`);

        // 后端下载图片（带完整 headers）
        const imageResponse = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://weibo.com/',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          }
        });

        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: HTTP ${imageResponse.status}`);
        }

        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const blob = await imageResponse.blob();

        if (blob.size < 1024) {
          throw new Error(`Image too small: ${blob.size} bytes`);
        }

        // 生成文件名
        const ext = contentType.split('/')[1] || 'jpg';
        const filename = `weibo-${Date.now()}.${ext}`;
        const key = 'memoraid/' + filename;

        // 上传到 R2
        await env.R2.put(key, blob.stream(), {
          httpMetadata: { contentType }
        });

        const r2Url = effectiveOrigin + '/assets/' + key;
        console.log(`[R2 Proxy] Upload success: ${r2Url}`);

        return new Response(JSON.stringify({
          success: true,
          url: r2Url
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        console.error(`[R2 Proxy] Error:`, e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 插件官网（marketing pages）- 参考 maxai.co 的信息结构重新设计
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
      return buildHtmlResponse(renderMarketingHome(effectiveOrigin));
    }

    // 定价页
    if (request.method === 'GET' && url.pathname === '/pricing') {
      return buildHtmlResponse(renderMarketingPricing(effectiveOrigin));
    }

    // 官方网站首页 - MaxAI风格重新设计
    if ((url.pathname === '/' || url.pathname === '') && request.method === 'GET') {
      const ASSETS_BASE = url.origin + '/assets/memoraid';
      const homepageHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Memoraid - AI 内容创作助手 | 在浏览时随时向AI提问</title>
    <meta name="description" content="Memoraid 是一款强大的 Chrome 扩展，使用 AI 总结网页/对话内容，一键生成自媒体文章，支持自动发布到头条号、知乎专栏、微信公众号。">
    <link rel="icon" type="image/png" href="${ASSETS_BASE}/icon-128.png">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #ffffff;
            --bg-secondary: #f9fafb;
            --bg-tertiary: #f3f4f6;
            --border: #e5e7eb;
            --text: #111827;
            --text-secondary: #6b7280;
            --text-muted: #9ca3af;
            --primary: #10b981;
            --primary-hover: #059669;
            --primary-light: rgba(16,185,129,0.1);
            --shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
            --shadow-lg: 0 10px 25px -5px rgba(0,0,0,0.1);
            --radius: 12px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', 'Noto Sans SC', -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
        
        /* 导航栏 */
        .navbar { position: fixed; top: 0; left: 0; right: 0; z-index: 1000; padding: 0 24px; height: 64px; background: rgba(255,255,255,0.95); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); }
        .navbar-inner { max-width: 1200px; margin: 0 auto; height: 100%; display: flex; align-items: center; justify-content: space-between; }
        .logo { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); }
        .logo-icon { width: 36px; height: 36px; border-radius: 10px; overflow: hidden; }
        .logo-icon img { width: 100%; height: 100%; object-fit: cover; }
        .logo-text { font-size: 1.125rem; font-weight: 600; }
        .nav-links { display: flex; align-items: center; gap: 8px; }
        .nav-link { color: var(--text-secondary); text-decoration: none; font-size: 0.875rem; font-weight: 500; padding: 8px 16px; border-radius: 8px; transition: all 0.2s; }
        .nav-link:hover { color: var(--text); background: var(--bg-tertiary); }
        .nav-actions { display: flex; align-items: center; gap: 12px; }
        .btn-login { color: var(--text-secondary); text-decoration: none; font-size: 0.875rem; font-weight: 500; padding: 8px 16px; border-radius: 8px; transition: all 0.2s; }
        .btn-login:hover { color: var(--text); background: var(--bg-tertiary); }
        .btn-install { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 10px; background: var(--primary); color: white; font-size: 0.875rem; font-weight: 600; text-decoration: none; transition: all 0.2s; }
        .btn-install:hover { background: var(--primary-hover); transform: translateY(-1px); }
        
        /* Hero区域 */
        .hero { padding: 120px 24px 80px; max-width: 1200px; margin: 0 auto; }
        .hero-content { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: center; }
        .hero-text { text-align: left; }
        .hero-title { font-size: clamp(2rem, 4vw, 2.75rem); font-weight: 700; line-height: 1.2; margin-bottom: 20px; color: var(--text); }
        .hero-subtitle { font-size: 1.125rem; color: var(--text-secondary); margin-bottom: 32px; line-height: 1.7; }
        .hero-actions { display: flex; gap: 12px; flex-wrap: wrap; }
        .btn-primary { display: inline-flex; align-items: center; gap: 10px; padding: 14px 28px; border-radius: 10px; background: var(--primary); color: white; font-size: 0.9375rem; font-weight: 600; text-decoration: none; transition: all 0.2s; }
        .btn-primary:hover { background: var(--primary-hover); transform: translateY(-1px); }
        .hero-stats { display: flex; align-items: center; gap: 32px; margin-top: 40px; padding-top: 32px; border-top: 1px solid var(--border); }
        .hero-stat-value { font-size: 1.5rem; font-weight: 700; color: var(--text); }
        .hero-stat-label { font-size: 0.8rem; color: var(--text-muted); margin-top: 4px; }
        .hero-visual { position: relative; background: var(--bg-secondary); border-radius: var(--radius); border: 1px solid var(--border); overflow: hidden; box-shadow: var(--shadow-lg); }
        .hero-image { width: 100%; height: auto; display: block; }
        
        /* 信任Logo墙 */
        .trust-section { padding: 60px 24px; text-align: center; border-top: 1px solid var(--border); background: var(--bg-secondary); }
        .trust-title { font-size: 0.875rem; color: var(--text-muted); margin-bottom: 32px; }
        .trust-logos { display: flex; align-items: center; justify-content: center; gap: 48px; flex-wrap: wrap; max-width: 900px; margin: 0 auto; opacity: 0.5; }
        .trust-logo { height: 24px; filter: grayscale(100%); transition: all 0.3s; }
        .trust-logo:hover { filter: grayscale(0%); opacity: 1; }
        
        /* 功能特性 */
        .features { padding: 100px 24px; max-width: 1200px; margin: 0 auto; }
        .section-header { text-align: center; margin-bottom: 64px; }
        .section-title { font-size: clamp(1.75rem, 3vw, 2.25rem); font-weight: 700; margin-bottom: 16px; }
        .section-desc { font-size: 1.1rem; color: var(--text-secondary); max-width: 600px; margin: 0 auto; }
        .features-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
        .feature-card { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; transition: all 0.3s; }
        .feature-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); border-color: var(--primary); }
        .feature-image { width: 100%; height: 160px; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 20px; overflow: hidden; }
        .feature-image img { width: 100%; height: 100%; object-fit: cover; }
        .feature-title { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
        .feature-desc { color: var(--text-secondary); font-size: 0.875rem; line-height: 1.6; }
        
        /* 使用案例 */
        .use-cases { padding: 100px 24px; background: var(--bg-secondary); }
        .use-cases-inner { max-width: 1200px; margin: 0 auto; }
        .tabs { display: flex; justify-content: center; gap: 8px; margin-bottom: 48px; flex-wrap: wrap; }
        .tab { padding: 10px 20px; border-radius: 100px; background: var(--bg); border: 1px solid var(--border); color: var(--text-secondary); font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .tab:hover, .tab.active { background: var(--text); color: white; border-color: var(--text); }
        .cases-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
        .case-card { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; transition: all 0.3s; }
        .case-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); }
        .case-image { width: 100%; height: 140px; background: var(--bg-tertiary); }
        .case-image img { width: 100%; height: 100%; object-fit: cover; }
        .case-title { padding: 16px; font-size: 0.875rem; font-weight: 500; }
        
        /* 统计数据 */
        .stats-section { padding: 80px 24px; text-align: center; }
        .stats-title { font-size: 1.5rem; font-weight: 600; margin-bottom: 48px; }
        .stats-grid { display: flex; justify-content: center; gap: 80px; flex-wrap: wrap; }
        .stat-item { text-align: center; }
        .stat-value { font-size: 2.5rem; font-weight: 700; color: var(--text); }
        .stat-label { font-size: 0.875rem; color: var(--text-muted); margin-top: 8px; }
        
        /* CTA区域 */
        .cta { padding: 80px 24px; background: var(--bg-secondary); text-align: center; }
        .cta-title { font-size: 1.75rem; font-weight: 600; margin-bottom: 24px; }
        .cta .btn-primary { padding: 16px 32px; font-size: 1rem; }
        
        /* 页脚 */
        .footer { padding: 60px 24px; border-top: 1px solid var(--border); }
        .footer-inner { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 2fr repeat(4, 1fr); gap: 48px; }
        .footer-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
        .footer-brand img { width: 32px; height: 32px; border-radius: 8px; }
        .footer-brand span { font-weight: 600; }
        .footer-copy { color: var(--text-muted); font-size: 0.8rem; }
        .footer-col h4 { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }
        .footer-col a { display: block; color: var(--text-secondary); text-decoration: none; font-size: 0.875rem; padding: 6px 0; transition: color 0.2s; }
        .footer-col a:hover { color: var(--text); }
        
        /* 响应式 */
        @media (max-width: 1024px) {
            .features-grid, .cases-grid { grid-template-columns: repeat(2, 1fr); }
            .footer-inner { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 768px) {
            .nav-links { display: none; }
            .hero-content { grid-template-columns: 1fr; text-align: center; }
            .hero-text { order: 1; }
            .hero-visual { order: 2; }
            .hero-actions { justify-content: center; }
            .hero-stats { justify-content: center; }
            .features-grid, .cases-grid { grid-template-columns: 1fr; }
            .stats-grid { gap: 40px; }
            .footer-inner { grid-template-columns: 1fr; text-align: center; }
        }
        .sortable { cursor: pointer; user-select: none; }
        .sortable:hover { color: var(--text); }
        .sortable.active { color: var(--accent); font-weight: 700; }
        .sortable.active::after { content: ' ↓'; }
        .sortable.asc::after { content: ' ↑'; }
        .pay-step-1 { display: block; }
        .pay-step-2 { display: none; }
        .pay-step-2 .qr-container { text-align: center; margin-top: 16px; }
        .pay-step-2 .order-info { 
            background: var(--bg-muted); 
            padding: 12px; 
            border-radius: 8px; 
            margin: 16px 0; 
            font-size: 0.9rem;
            color: var(--text-secondary);
            text-align: left;
        }
        .pay-step-2 .order-id { font-family: monospace; font-weight: 700; color: var(--accent); user-select: all; }
        .btn-confirm-pay {
            width: 100%;
            padding: 12px;
            background: var(--gradient-2);
            color: white;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 16px;
            white-space: normal;
            line-height: 1.4;
            height: auto;
            min-height: 44px;
        }
        .btn-confirm-pay:hover { opacity: 0.9; }
    </style>
</head>
<body>
    <!-- 导航栏 -->
    <nav class="navbar">
        <div class="navbar-inner">
            <a href="/" class="logo">
                <div class="logo-icon"><img src="\${ASSETS_BASE}/icon-128.png" alt="Memoraid"></div>
                <span class="logo-text">Memoraid</span>
            </a>
            <div class="nav-links">
                <a href="#features" class="nav-link">功能特性</a>
                <a href="#use-cases" class="nav-link">使用案例</a>
                <a href="/pricing" class="nav-link">定价</a>
                <a href="/user" class="nav-link">管理后台</a>
            </div>
            <div class="nav-actions">
                <a href="/login" class="btn-login">登录</a>
                <a href="https://chromewebstore.google.com/detail/memoraid/leonoilddlplhmmahjmnendflfnlnlmg" target="_blank" class="btn-install">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-3.952 6.848a12.014 12.014 0 0 0 9.229-9.006zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728z"/></svg>
                    免费添加到 Chrome
                </a>
            </div>
        </div>
    </nav>
    
    <!-- Hero区域 -->
    <section class="hero">
        <div class="hero-content">
            <div class="hero-text">
                <h1 class="hero-title">在浏览时向AI提问</h1>
                <p class="hero-subtitle">使用Memoraid浏览器扩展节省时间，您的日常工作AI助手。无论您在线工作还是需要，都能更快地阅读、写作和搜索。</p>
                <div class="hero-actions">
                    <a href="https://chromewebstore.google.com/detail/memoraid/leonoilddlplhmmahjmnendflfnlnlmg" target="_blank" class="btn-primary">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-3.952 6.848a12.014 12.014 0 0 0 9.229-9.006zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728z"/></svg>
                        免费添加到 Chrome
                    </a>
                </div>
                <div class="hero-stats">
                    <div class="hero-stat">
                        <div class="hero-stat-value">50万+</div>
                        <div class="hero-stat-label">活跃用户</div>
                    </div>
                    <div class="hero-stat">
                        <div class="hero-stat-value">4.9★</div>
                        <div class="hero-stat-label">用户评分</div>
                    </div>
                    <div class="hero-stat">
                        <div class="hero-stat-value">100%</div>
                        <div class="hero-stat-label">隐私友好</div>
                    </div>
                </div>
            </div>
            <div class="hero-visual">
                <img src="\${ASSETS_BASE}/promo-1400x560.png" alt="Memoraid 产品展示" class="hero-image">
            </div>
        </div>
    </section>
    
    <!-- 信任Logo墙 -->
    <section class="trust-section">
        <p class="trust-title">全球企业和大学的信任 🌍</p>
        <div class="trust-logos">
            <span style="font-weight:600;color:#666;">Uber</span>
            <span style="font-weight:600;color:#666;">Amazon</span>
            <span style="font-weight:600;color:#666;">Google</span>
            <span style="font-weight:600;color:#666;">Meta</span>
            <span style="font-weight:600;color:#666;">Stanford</span>
            <span style="font-weight:600;color:#666;">MIT</span>
            <span style="font-weight:600;color:#666;">清华大学</span>
            <span style="font-weight:600;color:#666;">北京大学</span>
        </div>
    </section>
    
    <!-- 功能特性 -->
    <section class="features" id="features">
        <div class="section-header">
            <h2 class="section-title">主要特点</h2>
            <p class="section-desc">强大的AI功能，让您的工作更高效</p>
        </div>
        <div class="features-grid">
            <div class="feature-card">
                <div class="feature-image" style="background:linear-gradient(135deg,#e0f2fe,#bae6fd);display:flex;align-items:center;justify-content:center;font-size:3rem;">🤖</div>
                <h3 class="feature-title">AI侧边栏</h3>
                <p class="feature-desc">在网站浏览时向AI提问，支持所有有最强AI模型。</p>
            </div>
            <div class="feature-card">
                <div class="feature-image" style="background:linear-gradient(135deg,#fce7f3,#fbcfe8);display:flex;align-items:center;justify-content:center;font-size:3rem;">🧠</div>
                <h3 class="feature-title">顶尖AI模型</h3>
                <p class="feature-desc">在一个地方访问所有有最强AI模型。</p>
            </div>
            <div class="feature-card">
                <div class="feature-image" style="background:linear-gradient(135deg,#d1fae5,#a7f3d0);display:flex;align-items:center;justify-content:center;font-size:3rem;">📄</div>
                <h3 class="feature-title">上下文AI</h3>
                <p class="feature-desc">随时随地阅读，支持复杂有趣的内容。</p>
            </div>
            <div class="feature-card">
                <div class="feature-image" style="background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center;font-size:3rem;">🔗</div>
                <h3 class="feature-title">引用来源</h3>
                <p class="feature-desc">获取准确信息和引用来源的答案。</p>
            </div>
            <div class="feature-card">
                <div class="feature-image" style="background:linear-gradient(135deg,#ede9fe,#ddd6fe);display:flex;align-items:center;justify-content:center;font-size:3rem;">✍️</div>
                <h3 class="feature-title">AI写作助手</h3>
                <p class="feature-desc">一键提升您在网络上的写作能力。</p>
            </div>
            <div class="feature-card">
                <div class="feature-image" style="background:linear-gradient(135deg,#cffafe,#a5f3fc);display:flex;align-items:center;justify-content:center;font-size:3rem;">🌐</div>
                <h3 class="feature-title">双语翻译</h3>
                <p class="feature-desc">并排查看原文和翻译文本。</p>
            </div>
            <div class="feature-card">
                <div class="feature-image" style="background:linear-gradient(135deg,#fee2e2,#fecaca);display:flex;align-items:center;justify-content:center;font-size:3rem;">💡</div>
                <h3 class="feature-title">可重用提示</h3>
                <p class="feature-desc">创建自己的提示，一键使用。</p>
            </div>
            <div class="feature-card">
                <div class="feature-image" style="background:linear-gradient(135deg,#f3e8ff,#e9d5ff);display:flex;align-items:center;justify-content:center;font-size:3rem;">🎨</div>
                <h3 class="feature-title">图像生成</h3>
                <p class="feature-desc">从文本创建图像，让您的想法变成现实。</p>
            </div>
        </div>
    </section>
    
    <!-- 使用案例 -->
    <section class="use-cases" id="use-cases">
        <div class="use-cases-inner">
            <div class="section-header">
                <h2 class="section-title">使用案例</h2>
            </div>
            <div class="tabs">
                <button class="tab active">推荐</button>
                <button class="tab">写作</button>
                <button class="tab">研究</button>
                <button class="tab">学习</button>
                <button class="tab">营销</button>
                <button class="tab">数据分析</button>
            </div>
            <div class="cases-grid">
                <div class="case-card">
                    <div class="case-image" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);display:flex;align-items:center;justify-content:center;font-size:2rem;">📝</div>
                    <div class="case-title">撰写长篇博客文章</div>
                </div>
                <div class="case-card">
                    <div class="case-image" style="background:linear-gradient(135deg,#fef2f2,#fee2e2);display:flex;align-items:center;justify-content:center;font-size:2rem;">🎬</div>
                    <div class="case-title">总结YouTube视频</div>
                </div>
                <div class="case-card">
                    <div class="case-image" style="background:linear-gradient(135deg,#eff6ff,#dbeafe);display:flex;align-items:center;justify-content:center;font-size:2rem;">📊</div>
                    <div class="case-title">用简单的术语解释复杂概念</div>
                </div>
                <div class="case-card">
                    <div class="case-image" style="background:linear-gradient(135deg,#fefce8,#fef9c3);display:flex;align-items:center;justify-content:center;font-size:2rem;">💬</div>
                    <div class="case-title">头脑风暴活动自己和朋友</div>
                </div>
            </div>
        </div>
    </section>
    
    <!-- 统计数据 -->
    <section class="stats-section">
        <h2 class="stats-title">他们喜欢Memoraid</h2>
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-value">#1</div>
                <div class="stat-label">Product Hunt 本周产品</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">100%</div>
                <div class="stat-label">隐私友好</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">40+</div>
                <div class="stat-label">每位用户每月节省的小时数</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">300%</div>
                <div class="stat-label">更好的内容理解质量和深度</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">5x</div>
                <div class="stat-label">更快的研究</div>
            </div>
        </div>
    </section>
    
    <!-- CTA区域 -->
    <section class="cta">
        <h2 class="cta-title">您日常工作的AI助手</h2>
        <a href="https://chromewebstore.google.com/detail/memoraid/leonoilddlplhmmahjmnendflfnlnlmg" target="_blank" class="btn-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-3.952 6.848a12.014 12.014 0 0 0 9.229-9.006zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728z"/></svg>
            免费添加到 Chrome
        </a>
    </section>
    
    <!-- 页脚 -->
    <footer class="footer">
        <div class="footer-inner">
            <div>
                <div class="footer-brand">
                    <img src="\${ASSETS_BASE}/icon-128.png" alt="Memoraid">
                    <span>Memoraid</span>
                </div>
                <p class="footer-copy">© 2026 Memoraid. All rights reserved.</p>
            </div>
            <div class="footer-col">
                <h4>应用</h4>
                <a href="#">Chrome扩展</a>
                <a href="#">Edge扩展</a>
            </div>
            <div class="footer-col">
                <h4>资源</h4>
                <a href="#">帮助中心</a>
                <a href="#">合作伙伴</a>
            </div>
            <div class="footer-col">
                <h4>公司</h4>
                <a href="#">联系我们</a>
                <a href="/privacy">隐私政策</a>
            </div>
            
        </div>
    </footer>
</body>
</html>`;
      return new Response(homepageHtml, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
    }


    // 0. Health Check & Config Test
    if (url.pathname === '/health' && request.method === 'GET') {
        const config = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            googleConfigured: !!env.GOOGLE_CLIENT_ID,
            githubConfigured: !!env.GITHUB_CLIENT_ID,
            dbConnected: !!env.DB
        };
        return new Response(JSON.stringify(config, null, 2), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // 0.1 OAuth Config - 返回 Client ID 供扩展直接构建 OAuth URL
    if (url.pathname.startsWith('/auth/config/') && request.method === 'GET') {
        const provider = url.pathname.split('/').pop();
        let clientId = '';
        
        if (provider === 'google') {
            clientId = env.GOOGLE_CLIENT_ID?.trim() || '';
        } else if (provider === 'github') {
            clientId = env.GITHUB_CLIENT_ID?.trim() || '';
        }
        
        if (!clientId) {
            return new Response(JSON.stringify({ error: 'Provider not configured' }), {
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
        
        return new Response(JSON.stringify({ 
            clientId,
            callbackUrl: effectiveOrigin + '/auth/callback/' + provider
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // 0.2 Privacy Policy (Public)
    if (url.pathname === '/privacy' && request.method === 'GET') {
        const html = `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>隐私政策 - Memoraid</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #333; }
                h1 { border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 30px; }
                h2 { margin-top: 30px; color: #2c3e50; border-left: 4px solid #10b981; padding-left: 15px; }
                h3 { margin-top: 20px; color: #444; }
                ul { padding-left: 20px; }
                li { margin-bottom: 10px; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #eee; padding: 12px; text-align: left; }
                th { background: #f8f9fa; }
                .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 0.9em; }
                .highlight { background: #fff3cd; padding: 2px 5px; border-radius: 3px; }
            </style>
        </head>
        <body>
            <h1>Memoraid 隐私政策</h1>
            <p><strong>最后更新日期：</strong> 2026年2月6日</p>

            <p>Memoraid（"本扩展程序"）是一款 Chrome 浏览器扩展工具。我们非常重视您的隐私，本政策详细说明了我们如何收集、使用、存储和分享您的数据，以符合 Chrome 网上应用店的政策要求。</p>

            <h2>1. 数据收集与使用披露</h2>
            <p>我们在此全面披露本扩展程序处理的数据类型及其用途：</p>
            
            <h3>2.1 网页内容数据 (Web Content)</h3>
            <ul>
                <li><strong>收集内容：</strong>当您主动触发“总结”或“提取”功能时，扩展程序会读取当前活动标签页的文本内容。</li>
                <li><strong>用途：</strong>提取的内容将发送至您配置的 AI 服务提供商（如 OpenAI, DeepSeek 等），用于生成摘要或文章。</li>
                <li><strong>处理：</strong>内容仅在您触发操作时读取，不会在后台静默收集。</li>
            </ul>

            <h3>2.2 身份验证与账户数据</h3>
            <ul>
                <li><strong>收集内容：</strong>如果您使用云同步功能，我们会通过 Google 或 GitHub OAuth 获取您的电子邮件地址和唯一用户 ID。</li>
                <li><strong>用途：</strong>用于管理您的账户并实现跨设备同步设置。</li>
            </ul>

            <h3>2.3 浏览器 Cookie (Cookies)</h3>
            <ul>
                <li><strong>收集内容：</strong>本扩展程序会访问特定自媒体平台（如头条号、知乎、微信公众号、小红书）的登录 Cookie。</li>
                <li><strong>用途：</strong>仅用于验证您的登录状态，以便实现“一键发布”功能。</li>
                <li><strong>处理：</strong>这些 Cookie 仅在本地使用，不会发送到我们的服务器。</li>
            </ul>

            <h2>2. 数据存储与安全</h2>
            <ul>
                <li><strong>本地存储：</strong>绝大部分数据（如 API 密钥、历史记录）使用 <code>chrome.storage</code> 存储在您的本地浏览器中。</li>
                <li><strong>云端加密：</strong>同步数据在发送前会进行 <strong class="highlight">AES-256 客户端加密</strong>。我们无法解密您的数据。</li>
                <li><strong>传输安全：</strong>所有数据均通过加密的 HTTPS 连接传输。</li>
            </ul>

            <h2>3. 数据分享</h2>
            <p>我们承诺：</p>
            <ul>
                <li><strong>不会</strong>将您的个人数据出售或出租给第三方。</li>
                <li><strong>不会</strong>为了广告或营销目的分享您的数据。</li>
                <li>数据仅分享给您主动选择的第三方服务（如您配置的 AI 提供商或您要发布的自媒体平台）。</li>
            </ul>

            <h2>4. 权限说明</h2>
            <table>
                <tr><th>权限</th><th>理由与用途</th></tr>
                <tr><td><code>storage</code></td><td>本地存储设置、API 密钥和任务历史。</td></tr>
                <tr><td><code>activeTab</code></td><td>仅在触发时获取当前页面内容。</td></tr>
                <tr><td><code>cookies</code></td><td>检查自媒体平台登录状态，实现一键发布。</td></tr>
                <tr><td><code>identity</code></td><td>提供 Google/GitHub 登录支持。</td></tr>
                <tr><td><code>host_permissions</code></td><td>允许与 AI 接口和自媒体平台通信。</td></tr>
            </table>

            <h2>5. 联系我们</h2>
            <p>如果您有任何疑问，请联系：nichuanfang@gmail.com</p>

            <div class="footer">
                <p>Memoraid - 您的 AI 内容创作助手</p>
            </div>
        </body>
        </html>
        `;
        return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=UTF-8' }
        });
    }

    // 0.3 Login Page - 登录页面
    if (url.pathname === '/login' && request.method === 'GET') {
        return buildHtmlResponse(renderMarketingLogin(effectiveOrigin, url.searchParams.get('error')));
    }

    // 0.4 Web Auth Callback - 网页登录回调
    if (url.pathname === '/auth/web-callback' && request.method === 'GET') {
        const token = url.searchParams.get('token');
        const email = url.searchParams.get('email');
        
        if (!token) {
            return Response.redirect(effectiveOrigin + '/login?error=auth_failed', 302);
        }
        
        // 设置 cookie 并跳转到后台
        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>登录成功</title>
</head>
<body>
    <script>
        // 保存 token 到 localStorage
        localStorage.setItem('memoraid_token', '${token}');
        localStorage.setItem('memoraid_email', '${email || ''}');
        // 跳转到后台
        window.location.href = '/user';
    </script>
</body>
</html>`;
        return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=UTF-8' }
        });
    }

    // 0.5 验证用户登录状态 API
    if (url.pathname === '/api/auth/verify' && request.method === 'GET') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer mock_jwt_')) {
            return new Response(JSON.stringify({ authenticated: false }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
        
        try {
            const tokenPart = authHeader.split('Bearer mock_jwt_')[1];
            const payload = JSON.parse(atob(tokenPart));
            
            // 检查 token 是否过期
            if (payload.exp && payload.exp < Date.now()) {
                return new Response(JSON.stringify({ authenticated: false, error: 'Token expired' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            return new Response(JSON.stringify({ 
                authenticated: true,
                userId: payload.userId,
                email: payload.email
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        } catch (e) {
            return new Response(JSON.stringify({ authenticated: false, error: 'Invalid token' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }

    // 1. Auth Init - Redirect to Provider
    if (url.pathname.startsWith('/auth/login/') && request.method === 'GET') {
       const provider = url.pathname.split('/').pop();
       const redirectUri = url.searchParams.get('redirect_uri');
       const anonymousId = url.searchParams.get('anonymousId');

       console.log('Auth Init:', { provider, redirectUri, anonymousId, origin: effectiveOrigin });

       if (!redirectUri) {
           console.error('Missing redirect_uri');
           return new Response('Missing redirect_uri', { status: 400 });
       }

       // Construct state object
       const statePayload = JSON.stringify({ redirectUri, anonymousId });
       const state = encodeURIComponent(statePayload);

       let authUrl = '';
       
       if (provider === 'google') {
           const clientId = env.GOOGLE_CLIENT_ID?.trim();
           if (!clientId) {
               console.error('GOOGLE_CLIENT_ID not configured');
               return new Response('Google OAuth not configured. Please set GOOGLE_CLIENT_ID environment variable.', { status: 500 });
           }
           authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(effectiveOrigin + '/auth/callback/google')}&response_type=code&scope=email%20profile&prompt=select_account&state=${state}`;
       } else if (provider === 'github') {
           const clientId = env.GITHUB_CLIENT_ID?.trim();
           if (!clientId) {
               console.error('GITHUB_CLIENT_ID not configured');
               return new Response('GitHub OAuth not configured. Please set GITHUB_CLIENT_ID environment variable.', { status: 500 });
           }
           authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(effectiveOrigin + '/auth/callback/github')}&scope=user:email&state=${state}`;
       } else {
           console.error('Invalid provider:', provider);
           return new Response('Invalid provider', { status: 400 });
       }

       console.log('Redirecting to OAuth:', authUrl.substring(0, 100) + '...');
       
       // 使用 HTML meta refresh 重定向，而不是 302，以解决 Chrome 扩展 launchWebAuthFlow 的兼容性问题
       const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="0;url=${authUrl}">
    <title>Redirecting...</title>
</head>
<body>
    <p>Redirecting to ${provider} login...</p>
    <p>If you are not redirected, <a href="${authUrl}">click here</a>.</p>
    <script>window.location.href = "${authUrl}";</script>
</body>
</html>`;
       
       return new Response(html, {
           headers: { 'Content-Type': 'text/html; charset=UTF-8' }
       });
    }

    // 2. Auth Callback - Exchange Code & Redirect to Extension
    if (url.pathname.startsWith('/auth/callback/') && request.method === 'GET') {
        const provider = url.pathname.split('/').pop();
        const code = url.searchParams.get('code');
        const stateParam = url.searchParams.get('state');
        
        let extRedirectUri = '';
        let anonymousId = '';

        try {
            const stateObj = JSON.parse(decodeURIComponent(stateParam || ''));
            extRedirectUri = stateObj.redirectUri;
            anonymousId = stateObj.anonymousId;
        } catch (e) {
            // Fallback for old clients or if state is just the URI
            extRedirectUri = decodeURIComponent(stateParam || '');
        }

        if (!code || !extRedirectUri) return new Response('Missing code or state', { status: 400 });

        try {
            let email = '';
            let providerId = '';

            if (provider === 'google') {
                // Exchange code for token
                const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        code,
                        client_id: env.GOOGLE_CLIENT_ID?.trim(),
                        client_secret: env.GOOGLE_CLIENT_SECRET?.trim(),
                        redirect_uri: effectiveOrigin + '/auth/callback/google',
                        grant_type: 'authorization_code'
                    })
                });
                const tokenData: any = await tokenResp.json();
                if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

                // Get User Info
                const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: { Authorization: `Bearer ${tokenData.access_token}` }
                });
                const userData: any = await userResp.json();
                email = userData.email;
                providerId = userData.id;

            } else if (provider === 'github') {
                const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        client_id: env.GITHUB_CLIENT_ID?.trim(),
                        client_secret: env.GITHUB_CLIENT_SECRET?.trim(),
                        code,
                        redirect_uri: effectiveOrigin + '/auth/callback/github'
                    })
                });
                const tokenData: any = await tokenResp.json();
                if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

                const userResp = await fetch('https://api.github.com/user', {
                    headers: { 
                        Authorization: `Bearer ${tokenData.access_token}`,
                        'User-Agent': 'Memoraid-Backend'
                    }
                });
                const userData: any = await userResp.json();
                email = userData.email; // Note: might be null if private
                providerId = String(userData.id);
                
                // Fallback for private emails
                if (!email) {
                    const emailsResp = await fetch('https://api.github.com/user/emails', {
                        headers: { 
                            Authorization: `Bearer ${tokenData.access_token}`,
                            'User-Agent': 'Memoraid-Backend'
                        }
                    });
                    const emails: any = await emailsResp.json();
                    email = emails.find((e: any) => e.primary)?.email || emails[0]?.email;
                }
            }

            // Create/Update User
            const oauthUserId = `${provider}_${providerId}`;
            let finalUserId = oauthUserId;
            
            // 1. Check if OAuth user exists (by ID or Email)
            let targetUser = await env.DB.prepare(
                `SELECT id FROM users WHERE id = ? OR email = ?`
            ).bind(oauthUserId, email).first();
            
            // 2. If not exists, check if we should adopt anonymous user
            if (!targetUser && anonymousId) {
                const anonUser = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(anonymousId).first();
                if (anonUser) {
                    // Update anonymous user to be this OAuth user
                    // We keep the ID as anonymousId (to preserve settings/logs references), but update email/provider info
                    await env.DB.prepare(
                        `UPDATE users SET email = ?, provider = ?, provider_id = ? WHERE id = ?`
                    ).bind(email, provider, providerId, anonymousId).run();
                    
                    finalUserId = anonymousId;
                    // Re-fetch to be safe (or just use anonymousId)
                    targetUser = { id: anonymousId } as any; 
                }
            }
            
            if (targetUser) {
                // User exists (or was just adopted). Update info.
                await env.DB.prepare(
                    `UPDATE users SET email = ?, provider = ?, provider_id = ? WHERE id = ?`
                ).bind(email, provider, providerId, targetUser.id).run();
                finalUserId = targetUser.id as string;
            } else {
                // New User (and no anonymous adoption)
                await env.DB.prepare(
                    `INSERT INTO users (id, email, provider, provider_id) VALUES (?, ?, ?, ?)`
                ).bind(finalUserId, email, provider, providerId).run();
            }

            // Generate App Token (Simple Mock JWT for demo, ideally use proper JWT lib)
            // For security, use a proper JWT library with signature in production
            const appToken = btoa(JSON.stringify({ userId: finalUserId, email, exp: Date.now() + 30 * 24 * 3600 * 1000 }));
            const fullToken = `mock_jwt_${appToken}`; // Using prefix for consistency with middleware

            // Redirect back to extension
            return Response.redirect(`${extRedirectUri}?token=${fullToken}&email=${encodeURIComponent(email)}`, 302);

        } catch (e: any) {
            return new Response(`Auth Failed: ${e.message}`, { status: 500 });
        }
    }
    
    // Middleware: Extract User ID from Token
    const authHeader = request.headers.get('Authorization');
    let userId = 'test_user';

    if (authHeader && authHeader.startsWith('Bearer mock_jwt_')) {
        try {
            const tokenPart = authHeader.split('Bearer mock_jwt_')[1];
            // If it's the old simple mock token
            if (tokenPart.startsWith('google_') || tokenPart.startsWith('github_')) {
                userId = tokenPart;
            } else {
                // Try decoding base64
                const payload = JSON.parse(atob(tokenPart));
                userId = payload.userId;
            }
        } catch (e) {
            // Invalid token
            // return new Response('Unauthorized', { status: 401, headers: corsHeaders });
        }
    } else {
        // Enforce Auth for settings routes in production
        // return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    // 2. GET Settings
    if (url.pathname === '/settings' && request.method === 'GET') {
      const result = await env.DB.prepare(
        'SELECT encrypted_data, salt, iv, updated_at FROM settings WHERE user_id = ?'
      ).bind(userId).first();

      if (!result) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
      }

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. POST Settings
    if (url.pathname === '/settings' && request.method === 'POST') {
      try {
        const body = await request.json() as SaveSettingsRequest;
        const { encryptedData, salt, iv } = body;

        // Ensure user exists to satisfy Foreign Key constraint
        // This handles cases where we use 'test_user' or db was reset but token remains
        await env.DB.prepare(
          `INSERT OR IGNORE INTO users (id, email, provider, provider_id) VALUES (?, ?, ?, ?)`
        ).bind(userId, `${userId}@placeholder.com`, 'system_auto', userId).run();

        await env.DB.prepare(
          `INSERT INTO settings (user_id, encrypted_data, salt, iv, updated_at) 
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET 
             encrypted_data=excluded.encrypted_data,
             salt=excluded.salt,
             iv=excluded.iv,
             updated_at=excluded.updated_at`
        ).bind(userId, encryptedData, salt, iv, Math.floor(Date.now() / 1000)).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message || String(e) }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 4. GET Shared API Key - 为用户分配一个共享的 NVIDIA API 密钥
    if (url.pathname === '/api-key/nvidia' && request.method === 'GET') {
      try {
        // 使用设备指纹或 IP 作为用户标识（匿名用户也可以使用）
        const clientId = request.headers.get('X-Client-Id') || 
                         request.headers.get('CF-Connecting-IP') || 
                         'anonymous_' + Math.random().toString(36).substring(7);
        
        // 检查用户是否已经分配了密钥
        const existingAssignment = await env.DB.prepare(
          `SELECT ak.api_key FROM user_api_key_assignments ua 
           JOIN api_keys ak ON ua.api_key_id = ak.id 
           WHERE ua.user_id = ? AND ak.is_active = 1`
        ).bind(clientId).first();
        
        if (existingAssignment) {
          // 更新使用统计
          await env.DB.prepare(
            `UPDATE api_keys SET usage_count = usage_count + 1, last_used_at = ? 
             WHERE api_key = ?`
          ).bind(Math.floor(Date.now() / 1000), existingAssignment.api_key).run();
          
          return new Response(JSON.stringify({ 
            apiKey: existingAssignment.api_key,
            cached: true 
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 随机选择一个活跃的密钥（负载均衡）
        const randomKey = await env.DB.prepare(
          `SELECT id, api_key FROM api_keys 
           WHERE is_active = 1 AND provider = 'nvidia'
           ORDER BY usage_count ASC, RANDOM() 
           LIMIT 1`
        ).first();
        
        if (!randomKey) {
          return new Response(JSON.stringify({ error: 'No available API keys' }), {
            status: 503,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 分配密钥给用户
        await env.DB.prepare(
          `INSERT OR REPLACE INTO user_api_key_assignments (user_id, api_key_id, assigned_at) 
           VALUES (?, ?, ?)`
        ).bind(clientId, randomKey.id, Math.floor(Date.now() / 1000)).run();
        
        // 更新使用统计
        await env.DB.prepare(
          `UPDATE api_keys SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?`
        ).bind(Math.floor(Date.now() / 1000), randomKey.id).run();
        
        return new Response(JSON.stringify({ 
          apiKey: randomKey.api_key,
          cached: false 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 5. POST Logs (Debug Mode)
    if (url.pathname === '/logs' && request.method === 'POST') {
      try {
        const body = await request.json() as any;
        const { error, stack, context, userAgent, url: pageUrl } = body;
        
        // We use the userId from auth middleware if available, or 'anonymous'
        // Since logs might come from unauthenticated contexts in debug mode, we allow it.
        const logUserId = userId || 'anonymous';

        await env.DB.prepare(
          `INSERT INTO logs (user_id, error, stack, context, user_agent, url) 
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          logUserId, 
          error || 'Unknown Error', 
          stack || '', 
          JSON.stringify(context || {}), 
          userAgent || '', 
          pageUrl || ''
        ).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // ==================== 远程调试系统 API ====================

    // 6.1 POST /debug/session - 插件注册调试会话（生成验证码）
    if (url.pathname === '/debug/session' && request.method === 'POST') {
      try {
        const body = await request.json() as any;
        const { pluginInfo } = body;
        
        // 生成6位随机验证码
        const verificationCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // 创建调试会话
        await env.DB.prepare(
          `INSERT INTO debug_sessions (verification_code, plugin_info, is_active, last_heartbeat) 
           VALUES (?, ?, 1, ?)`
        ).bind(verificationCode, JSON.stringify(pluginInfo || {}), Math.floor(Date.now() / 1000)).run();

        return new Response(JSON.stringify({ 
          success: true,
          verificationCode,
          message: '调试会话已创建，请在后台使用此验证码发送命令'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // 6.2 POST /debug/command - 发送调试命令到指定插件
    if (url.pathname === '/debug/command' && request.method === 'POST') {
      try {
        const body = await request.json() as any;
        const { verificationCode, commandType, commandData } = body;

        if (!verificationCode || !commandType) {
          return new Response(JSON.stringify({ error: '缺少验证码或命令类型' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 验证会话是否存在且活跃
        const session = await env.DB.prepare(
          `SELECT * FROM debug_sessions WHERE verification_code = ? AND is_active = 1`
        ).bind(verificationCode).first();

        if (!session) {
          return new Response(JSON.stringify({ error: '无效的验证码或会话已过期' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 插入命令
        const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5分钟过期
        const result = await env.DB.prepare(
          `INSERT INTO debug_commands (verification_code, command_type, command_data, status, expires_at) 
           VALUES (?, ?, ?, 'pending', ?)`
        ).bind(verificationCode, commandType, JSON.stringify(commandData || {}), expiresAt).run();

        return new Response(JSON.stringify({ 
          success: true,
          commandId: result.meta.last_row_id,
          message: '命令已发送，等待插件执行'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // 6.3 GET /debug/poll/:code - 插件轮询待执行的命令
    if (url.pathname.startsWith('/debug/poll/') && request.method === 'GET') {
      try {
        const verificationCode = url.pathname.split('/').pop();
        
        if (!verificationCode) {
          return new Response(JSON.stringify({ error: '缺少验证码' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 更新会话心跳
        await env.DB.prepare(
          `UPDATE debug_sessions SET last_heartbeat = ? WHERE verification_code = ?`
        ).bind(Math.floor(Date.now() / 1000), verificationCode).run();

        // 获取待执行的命令（只取最早的一条）
        const now = Math.floor(Date.now() / 1000);
        const command = await env.DB.prepare(
          `SELECT id, command_type, command_data, created_at 
           FROM debug_commands 
           WHERE verification_code = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > ?)
           ORDER BY created_at ASC 
           LIMIT 1`
        ).bind(verificationCode, now).first();

        if (!command) {
          return new Response(JSON.stringify({ 
            hasCommand: false,
            message: '暂无待执行命令'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 标记命令为执行中
        await env.DB.prepare(
          `UPDATE debug_commands SET status = 'executing' WHERE id = ?`
        ).bind(command.id).run();

        return new Response(JSON.stringify({ 
          hasCommand: true,
          command: {
            id: command.id,
            type: command.command_type,
            data: JSON.parse(command.command_data as string || '{}')
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // 6.4 POST /debug/result - 插件上报命令执行结果
    if (url.pathname === '/debug/result' && request.method === 'POST') {
      try {
        const body = await request.json() as any;
        const { commandId, verificationCode, resultType, resultData, screenshotBase64, executionTime } = body;

        if (!commandId || !verificationCode) {
          return new Response(JSON.stringify({ error: '缺少命令ID或验证码' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 更新命令状态
        const newStatus = resultType === 'success' ? 'completed' : 'failed';
        await env.DB.prepare(
          `UPDATE debug_commands SET status = ? WHERE id = ?`
        ).bind(newStatus, commandId).run();

        // 插入结果
        await env.DB.prepare(
          `INSERT INTO debug_results (command_id, verification_code, result_type, result_data, screenshot_base64, execution_time) 
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          commandId, 
          verificationCode, 
          resultType || 'success',
          JSON.stringify(resultData || {}),
          screenshotBase64 || null,
          executionTime || 0
        ).run();

        return new Response(JSON.stringify({ 
          success: true,
          message: '结果已上报'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // 6.5 GET /debug/result/:commandId - 获取命令执行结果
    if (url.pathname.startsWith('/debug/result/') && request.method === 'GET') {
      try {
        const commandId = url.pathname.split('/').pop();
        
        if (!commandId) {
          return new Response(JSON.stringify({ error: '缺少命令ID' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 获取命令状态
        const command = await env.DB.prepare(
          `SELECT id, command_type, command_data, status, created_at FROM debug_commands WHERE id = ?`
        ).bind(commandId).first();

        if (!command) {
          return new Response(JSON.stringify({ error: '命令不存在' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 获取结果
        const result = await env.DB.prepare(
          `SELECT result_type, result_data, screenshot_base64, execution_time, created_at 
           FROM debug_results WHERE command_id = ? ORDER BY created_at DESC LIMIT 1`
        ).bind(commandId).first();

        return new Response(JSON.stringify({ 
          command: {
            id: command.id,
            type: command.command_type,
            data: JSON.parse(command.command_data as string || '{}'),
            status: command.status
          },
          result: result ? {
            type: result.result_type,
            data: JSON.parse(result.result_data as string || '{}'),
            screenshot: result.screenshot_base64,
            executionTime: result.execution_time,
            timestamp: result.created_at
          } : null
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // 6.6 GET /debug/sessions - 获取所有活跃的调试会话
    if (url.pathname === '/debug/sessions' && request.method === 'GET') {
      try {
        const sessions = await env.DB.prepare(
          `SELECT verification_code, plugin_info, last_heartbeat, created_at 
           FROM debug_sessions 
           WHERE is_active = 1 AND last_heartbeat > ?
           ORDER BY created_at DESC`
        ).bind(Math.floor(Date.now() / 1000) - 300).all(); // 5分钟内有心跳的会话

        return new Response(JSON.stringify({ 
          sessions: sessions.results.map((s: any) => ({
            code: s.verification_code,
            pluginInfo: JSON.parse(s.plugin_info || '{}'),
            lastHeartbeat: s.last_heartbeat,
            createdAt: s.created_at
          }))
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // 6.7 DELETE /debug/session/:code - 关闭调试会话
    if (url.pathname.startsWith('/debug/session/') && request.method === 'DELETE') {
      try {
        const verificationCode = url.pathname.split('/').pop();
        
        await env.DB.prepare(
          `UPDATE debug_sessions SET is_active = 0 WHERE verification_code = ?`
        ).bind(verificationCode).run();

        return new Response(JSON.stringify({ 
          success: true,
          message: '调试会话已关闭'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // 6.8 GET /debug/history/:code - 获取会话的命令历史
    if (url.pathname.startsWith('/debug/history/') && request.method === 'GET') {
      try {
        const verificationCode = url.pathname.split('/').pop();
        
        const commands = await env.DB.prepare(
          `SELECT c.id, c.command_type, c.command_data, c.status, c.created_at,
                  r.result_type, r.result_data, r.execution_time
           FROM debug_commands c
           LEFT JOIN debug_results r ON c.id = r.command_id
           WHERE c.verification_code = ?
           ORDER BY c.created_at DESC
           LIMIT 50`
        ).bind(verificationCode).all();

        return new Response(JSON.stringify({ 
          history: commands.results.map((c: any) => ({
            id: c.id,
            type: c.command_type,
            data: JSON.parse(c.command_data || '{}'),
            status: c.status,
            createdAt: c.created_at,
            result: c.result_type ? {
              type: c.result_type,
              data: JSON.parse(c.result_data || '{}'),
              executionTime: c.execution_time
            } : null
          }))
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // ==================== AI 代理 API (免费额度控制) ====================
    // DeepSeek API Key (HARDCODED as requested by user, normally should be env var)
    // const DEEPSEEK_API_KEY = 'sk-b0c3021b637a4a71abc964d089e9d6df';
    const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

    // 8.0 POST /api/ai/chat/completions - 代理 Chat Completions
    if (url.pathname === '/api/ai/chat/completions' && request.method === 'POST') {
      try {
        // 获取用户 ID 或匿名 ID
        const userId = getUserIdFromRequest(request);
        const anonymousId = request.headers.get('X-Anonymous-ID');
        
        // 0. Get API Key from DB
        let deepseekKey = '';
        try {
             const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'deepseek_api_key'").first();
             if (row) {
                 deepseekKey = row.value as string;
             } else {
                 console.error('API Key not found in DB');
                 return new Response(JSON.stringify({ error: 'System configuration missing (API Key)' }), { status: 500, headers: corsHeaders });
             }
        } catch (e) {
            console.error('Failed to get API key from DB:', e);
            return new Response(JSON.stringify({ error: 'System configuration error' }), { status: 500, headers: corsHeaders });
        }

        // 1. Check Usage Limit (Free: 5 for anonymous, 20 for logged in)
        let usageLimit = 5;
        let currentUsage = 0;
        let trackingId = '';
        let trackingType = ''; // 'user' or 'anonymous'
        let hasPaidQuota = false; // 是否有付费额度

        if (userId) {
            // 已登录用户：先检查免费额度（限额 20）
            usageLimit = 20;
            trackingId = userId;
            trackingType = 'user';
            currentUsage = await env.DB.prepare(
                'SELECT COUNT(*) as count FROM ai_usage_logs WHERE user_id = ?'
            ).bind(userId).first('count') as number;
            
            // 如果免费额度用完，检查付费额度
            if (currentUsage >= usageLimit) {
                const quotaRow = await env.DB.prepare(
                    'SELECT paid_quota_remaining FROM user_quotas WHERE user_id = ?'
                ).bind(userId).first();
                const paidQuota = quotaRow?.paid_quota_remaining || 0;
                
                if (paidQuota > 0) {
                    // 有付费额度，允许继续使用
                    hasPaidQuota = true;
                    console.log(`[AI Chat] 用户 ${userId} 免费额度已用完，使用付费额度（剩余: ${paidQuota}）`);
                }
            }
        } else if (anonymousId) {
            // 未登录用户：限额 5
            usageLimit = 5;
            trackingId = anonymousId;
            trackingType = 'anonymous';
            currentUsage = await env.DB.prepare(
                'SELECT COUNT(*) as count FROM ai_usage_logs WHERE anonymous_id = ?'
            ).bind(anonymousId).first('count') as number;
        } else {
            // 既无登录也无匿名 ID，拒绝
             return new Response(JSON.stringify({ error: 'Unauthorized: No user or anonymous ID provided' }), { status: 401, headers: corsHeaders });
        }

        // 只有在免费额度用完且没有付费额度时才拒绝请求
        if (currentUsage >= usageLimit && !hasPaidQuota) {
           const message = userId 
             ? `Free limit reached (${usageLimit} articles). Please upgrade or contact support.`
             : `Trial limit reached (${usageLimit} articles). Please login to get 15 more free generations!`;
             
           return new Response(JSON.stringify({ 
             error: {
                 message: message,
                 code: 'rate_limit_exceeded',
                 limit: usageLimit,
                 usage: currentUsage
             }
           }), { status: 403, headers: corsHeaders });
        }

        // 2. Forward to DeepSeek
        // Note: request.json() can only be read once. We need to clone or read text.
        // We already need body for model check.
        const bodyText = await request.text();
        const body = JSON.parse(bodyText);
        
        // Ensure model is set (or force it)
        if (!body.model) body.model = 'deepseek-chat';

        const aiResponse = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${deepseekKey}`
          },
          body: bodyText
        });

        if (aiResponse.ok) {
            // 3. Log Usage (Only if successful)
            // 【修复】AI聊天不扣除额度，只记录使用日志
            // 额度扣除统一在 /api/articles/report 端点处理
            try {
                if (trackingType === 'user') {
                    // 只记录免费额度使用日志，不扣除付费额度
                    // 付费额度的扣除在文章报告时统一处理
                    if (!hasPaidQuota) {
                        // 没有付费额度，记录免费额度使用
                        await env.DB.prepare(
                            'INSERT INTO ai_usage_logs (user_id, model) VALUES (?, ?)'
                        ).bind(userId, body.model).run();
                        console.log(`[AI Chat] 已记录用户 ${userId} 的免费额度使用`);
                    } else {
                        console.log(`[AI Chat] 用户 ${userId} 使用付费额度，不在此处扣除（将在文章报告时扣除）`);
                    }
                } else {
                    // 匿名用户，记录免费额度使用
                    await env.DB.prepare(
                        'INSERT INTO ai_usage_logs (anonymous_id, model) VALUES (?, ?)'
                    ).bind(anonymousId, body.model).run();
                }
            } catch (e) {
                console.error('Failed to log AI usage:', e);
            }
        }

        // 4. Return Response (Stream or JSON)
        const newHeaders = new Headers(aiResponse.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        // Add custom headers for client to track usage
        newHeaders.set('X-Free-Limit', usageLimit.toString());
        newHeaders.set('X-Free-Remaining', Math.max(0, usageLimit - currentUsage - 1).toString()); // -1 because we just used one
        
        return new Response(aiResponse.body, {
          status: aiResponse.status,
          headers: newHeaders
        });

      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ==================== 文章发布统计系统 API ====================
    const ADMIN_EMAILS = ['huangguang52@gmail.com', 'ralph.wren@gmail.com', '1552013823@qq.com', 'admin'];

    // 7.0.5 POST /api/feedback - 用户反馈提交
    if (url.pathname === '/api/feedback' && request.method === 'POST') {
      try {
        // 获取用户ID（支持匿名用户）
        let userId = getUserIdFromRequest(request);
        const body = await request.json() as any;
        const { type, content } = body;

        // 验证反馈类型
        if (!['experience', 'suggestion', 'bug'].includes(type)) {
          return new Response(JSON.stringify({ error: '无效的反馈类型' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 验证反馈内容
        if (!content || content.trim().length === 0) {
          return new Response(JSON.stringify({ error: '反馈内容不能为空' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (content.length > 500) {
          return new Response(JSON.stringify({ error: '反馈内容不能超过500字符' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 获取用户邮箱（如果已登录）
        let userEmail = null;
        if (userId) {
          const userRow = await env.DB.prepare(
            'SELECT email FROM users WHERE id = ?'
          ).bind(userId).first();
          if (userRow) {
            userEmail = userRow.email;
          }
        }

        // 插入反馈记录
        await env.DB.prepare(
          `INSERT INTO feedback (user_id, user_email, type, content, status, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?)`
        ).bind(
          userId || null,
          userEmail || null,
          type,
          content.trim(),
          Math.floor(Date.now() / 1000)
        ).run();

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error: any) {
        console.error('Feedback submission error:', error);
        return new Response(JSON.stringify({ error: error.message || '提交失败' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 7.1 POST /api/articles/report - 上报文章发布信息
    if (url.pathname === '/api/articles/report' && request.method === 'POST') {
      try {
        // Allow anonymous users to report articles
        // If not authenticated, we use the account.id from payload as user_id (which should be anonymousId)
        let userId = getUserIdFromRequest(request);
        const body = await request.json() as any;
        
        // If no authenticated userId, try to use the one from payload if it looks like an anonymousId
        if (!userId && body.account && body.account.id && body.account.id.startsWith('anon_')) {
            userId = body.account.id;
            
            // Ensure anonymous user exists in DB
            await env.DB.prepare(
                `INSERT OR IGNORE INTO users (id, email, provider, provider_id) VALUES (?, ?, ?, ?)`
            ).bind(userId, `${userId}@anonymous.com`, 'anonymous', userId).run();
        }

        if (!userId) {
             // Fallback for very old clients or errors? Or just reject.
             // For now, let's reject to ensure data integrity
             return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const { platform, account, articles } = body;

        // 【新增】检查用户额度 - 每篇文章消耗1次额度
        const user = await env.DB.prepare('SELECT provider FROM users WHERE id = ?').bind(userId).first();
        const isAnonymous = user?.provider === 'anonymous';
        const freeLimit = isAnonymous ? 5 : 20;
        
        // 查询已使用次数（从ai_usage_logs表）
        const usageCount = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM ai_usage_logs WHERE user_id = ?'
        ).bind(userId).first('count') as number || 0;
        
        // 查询付费额度
        const quotaRow = await env.DB.prepare(
          'SELECT paid_quota_remaining FROM user_quotas WHERE user_id = ?'
        ).bind(userId).first();
        const paidQuota = quotaRow?.paid_quota_remaining || 0;
        
        // 计算剩余额度
        const freeRemaining = Math.max(0, freeLimit - usageCount);
        const totalRemaining = freeRemaining + paidQuota;
        
        // 检查是否有足够额度（每篇文章需要1次额度）
        const articlesCount = articles.length;
        if (totalRemaining < articlesCount) {
          return new Response(JSON.stringify({ 
            error: 'Insufficient quota',
            message: `额度不足。需要 ${articlesCount} 次，剩余 ${totalRemaining} 次`,
            quota: {
              free_remaining: freeRemaining,
              paid_remaining: paidQuota,
              total_remaining: totalRemaining,
              required: articlesCount
            }
          }), { status: 403, headers: corsHeaders });
        }

        // 1. Get or Create Platform
        let platformId = await env.DB.prepare('SELECT id FROM platforms WHERE name = ?').bind(platform).first('id');
        if (!platformId) {
          // Auto-create platform if known or just generic? For now assume known platforms are seeded.
          // Fallback to 'other' or error?
          // Let's create it dynamically for flexibility
          const result = await env.DB.prepare(
            'INSERT INTO platforms (name, display_name, icon) VALUES (?, ?, ?)'
          ).bind(platform, platform, '📱').run();
          platformId = result.meta.last_row_id;
        }

        // 2. Create/Update Account
        // Note: account.id is the ID on the platform (e.g. weixin openid), NOT our system userId
        
        let accountDbId = await env.DB.prepare(
            'SELECT id FROM accounts WHERE platform_id = ? AND account_id = ?'
        ).bind(platformId, account.id).first('id');

        if (!accountDbId) {
             // 使用 INSERT OR IGNORE 避免并发插入冲突
             const result = await env.DB.prepare(
                `INSERT OR IGNORE INTO accounts (platform_id, account_id, user_id, account_name, avatar_url, extra_info, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
             ).bind(
                 platformId, 
                 account.id, 
                 userId,
                 account.name || 'Unknown', 
                 account.avatar || '', 
                 JSON.stringify(account.extra || {}),
                 Math.floor(Date.now() / 1000)
             ).run();
             // 如果 INSERT OR IGNORE 没有插入（因为已存在），last_row_id 会是 0
             // 所以需要再次查询
             if (result.meta.last_row_id) {
                 accountDbId = result.meta.last_row_id;
             } else {
                 accountDbId = await env.DB.prepare(
                     'SELECT id FROM accounts WHERE platform_id = ? AND account_id = ?'
                 ).bind(platformId, account.id).first('id');
             }
        }
        
        // 始终更新账号信息和 user_id
        if (accountDbId) {
            await env.DB.prepare(
                `UPDATE accounts SET user_id = ?, account_name = ?, avatar_url = ?, extra_info = ?, updated_at = ? WHERE id = ?`
            ).bind(
                userId,
                account.name || 'Unknown',
                account.avatar || '',
                JSON.stringify(account.extra || {}),
                Math.floor(Date.now() / 1000),
                accountDbId
            ).run();
        }

        // 3. Process Articles
        let newArticlesCount = 0; // 记录新增文章数量（只统计 status='generated' 的新文章）
        for (const article of articles) {
            const { id: articleId, title, summary, cover, url: articleUrl, publishTime, status, extra } = article;
            
            // 检查文章是否已存在
            const existingArticle = await env.DB.prepare(
                'SELECT id, status FROM articles WHERE account_id = ? AND article_id = ?'
            ).bind(accountDbId, articleId).first();
            
            // 【调试日志】记录文章处理情况
            console.log(`[Article Report] 处理文章: articleId=${articleId}, accountDbId=${accountDbId}, exists=${!!existingArticle}, existingStatus=${existingArticle?.status}, newStatus=${status}`);
            
            await env.DB.prepare(
                `INSERT INTO articles (account_id, article_id, title, content_summary, cover_image, article_url, publish_time, status, extra_info, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(account_id, article_id) DO UPDATE SET
                 title=excluded.title,
                 content_summary=excluded.content_summary,
                 cover_image=excluded.cover_image,
                 article_url=excluded.article_url,
                 publish_time=excluded.publish_time,
                 status=excluded.status,
                 extra_info=excluded.extra_info,
                 updated_at=excluded.updated_at`
            ).bind(
                accountDbId,
                articleId,
                title,
                summary || '',
                cover || '',
                articleUrl || '',
                publishTime,
                status || 'published',
                JSON.stringify(extra || {}),
                Math.floor(Date.now() / 1000)
            ).run();
            
            // 【修复】只对 status='generated' 的新文章扣除额度
            // 这样即使去重失败，'published' 状态的文章也不会重复扣除
            if (!existingArticle && status === 'generated') {
                newArticlesCount++;
                console.log(`[Article Report] 新生成的文章，将扣除额度: articleId=${articleId}`);
            } else if (existingArticle) {
                console.log(`[Article Report] 已存在文章，不扣除额度: articleId=${articleId}`);
            } else if (status !== 'generated') {
                console.log(`[Article Report] 非生成状态(${status})，不扣除额度: articleId=${articleId}`);
            }
        }

        // 【新增】扣除额度 - 只为新文章扣除
        if (newArticlesCount > 0) {
            console.log(`[Article Report] 准备扣除额度: newArticlesCount=${newArticlesCount}, paidQuota=${paidQuota}, userId=${userId}`);
            
            // 优先扣除付费额度，再扣除免费额度
            if (paidQuota > 0) {
                const deductFromPaid = Math.min(paidQuota, newArticlesCount);
                await env.DB.prepare(
                    'UPDATE user_quotas SET paid_quota_remaining = paid_quota_remaining - ? WHERE user_id = ?'
                ).bind(deductFromPaid, userId).run();
                
                console.log(`[Article Report] 已扣除付费额度: ${deductFromPaid} 次`);
                
                const remainingToDeduct = newArticlesCount - deductFromPaid;
                if (remainingToDeduct > 0) {
                    // 记录免费额度使用
                    for (let i = 0; i < remainingToDeduct; i++) {
                        await env.DB.prepare(
                            'INSERT INTO ai_usage_logs (user_id, model) VALUES (?, ?)'
                        ).bind(userId, 'article-generation').run();
                    }
                    console.log(`[Article Report] 已扣除免费额度: ${remainingToDeduct} 次`);
                }
            } else {
                // 全部从免费额度扣除
                for (let i = 0; i < newArticlesCount; i++) {
                    await env.DB.prepare(
                        'INSERT INTO ai_usage_logs (user_id, model) VALUES (?, ?)'
                    ).bind(userId, 'article-generation').run();
                }
                console.log(`[Article Report] 已扣除免费额度: ${newArticlesCount} 次`);
            }
        } else {
            console.log(`[Article Report] 无新文章，不扣除额度`);
        }

        // 【新增】记录Analytics数据点 - 文章发布统计
        if (newArticlesCount > 0) {
            try {
                env.Memoraid.writeDataPoint({
                    // 索引字段 - 用于查询和聚合
                    indexes: [userId, platform], // 用户ID和平台名称作为索引
                    // 数值字段 - 用于统计和计算
                    blobs: [
                        `article_count:${newArticlesCount}`, // 文章数量
                        `total_articles:${articles.length}`, // 总文章数（包括重复）
                        `account:${account.id}` // 账号ID
                    ],
                    // 双精度数值 - 用于数值计算
                    doubles: [newArticlesCount] // 新文章数量
                });
            } catch (analyticsError) {
                // Analytics失败不影响主流程
                console.error('Analytics write failed:', analyticsError);
            }
        }

        return new Response(JSON.stringify({ 
            success: true,
            articles_processed: articles.length,
            new_articles: newArticlesCount,
            quota_used: newArticlesCount
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0 POST /auth/login/password - 密码登录 (普通用户)
    if (url.pathname === '/auth/login/password' && request.method === 'POST') {
      try {
        const { username, password } = await request.json() as any;
        if (!username || !password) {
          return new Response(JSON.stringify({ error: 'Username and password required' }), { status: 400, headers: corsHeaders });
        }

        const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(username).first();
        if (!user || !user.password_hash) {
          return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: corsHeaders });
        }

        // 验证密码 (简单 SHA-256)
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (hashHex !== user.password_hash) {
          return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: corsHeaders });
        }

        // 生成 Token
        const tokenPayload = {
          userId: user.id,
          email: user.email,
          exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
        };
        const token = 'mock_jwt_' + btoa(JSON.stringify(tokenPayload));

        // 【新增】记录Analytics数据点 - 用户登录统计
        try {
            env.Memoraid.writeDataPoint({
                indexes: [user.id as string, 'login', 'password'], // 用户ID、事件类型、登录方式
                blobs: [`email:${user.email}`], // 用户邮箱
                doubles: [1] // 登录次数计数
            });
        } catch (analyticsError) {
            console.error('Analytics write failed:', analyticsError);
        }

        return new Response(JSON.stringify({
          success: true,
          token,
          user: {
            id: user.id,
            email: user.email,
            mustChangePassword: !!user.must_change_password
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0.1 POST /auth/change-password - 修改密码
    if (url.pathname === '/auth/change-password' && request.method === 'POST') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const { oldPassword, newPassword } = await request.json() as any;
        if (!newPassword || newPassword.length < 6) {
          return new Response(JSON.stringify({ error: 'New password must be at least 6 characters' }), { status: 400, headers: corsHeaders });
        }

        const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
        if (!user) {
          return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: corsHeaders });
        }

        // 验证旧密码 (如果是强制修改且是默认密码，可能不需要验证旧密码？不，安全起见还是要验证)
        // 如果是 OAuth 用户没有密码，这里会失败，符合预期
        if (user.password_hash) {
          const encoder = new TextEncoder();
          const data = encoder.encode(oldPassword);
          const hashBuffer = await crypto.subtle.digest('SHA-256', data);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          
          if (hashHex !== user.password_hash) {
            return new Response(JSON.stringify({ error: 'Old password incorrect' }), { status: 401, headers: corsHeaders });
          }
        } else {
           return new Response(JSON.stringify({ error: 'Password not set for this user' }), { status: 400, headers: corsHeaders });
        }

        // 设置新密码
        const encoder = new TextEncoder();
        const data = encoder.encode(newPassword);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        await env.DB.prepare(
          'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?'
        ).bind(hashHex, userId).run();

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0 POST /auth/admin/login - 系统管理员登录
    if (url.pathname === '/auth/admin/login' && request.method === 'POST') {
      try {
        const { username, password } = await request.json() as any;
        if (!username || !password) {
          return new Response(JSON.stringify({ error: 'Username and password required' }), { status: 400, headers: corsHeaders });
        }

        // 初始化默认系统管理员 (如果不存在)
        if (username === 'admin') {
          let adminUser = await env.DB.prepare('SELECT * FROM admins WHERE username = ?').bind('admin').first();
          if (!adminUser) {
            // default password: "admin" -> sha256("123456") = 8d969eef...
            const defaultHash = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92'; 
            const adminId = 'admin_' + Date.now();
            await env.DB.prepare(
              'INSERT INTO admins (id, username, password_hash, must_change_password) VALUES (?, ?, ?, ?)'
            ).bind(adminId, 'admin', defaultHash, 1).run();
          }
        }

        const admin = await env.DB.prepare('SELECT * FROM admins WHERE username = ?').bind(username).first();
        if (!admin || !admin.password_hash) {
          return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: corsHeaders });
        }

        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (hashHex !== admin.password_hash) {
          return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: corsHeaders });
        }

        const tokenPayload = {
          userId: admin.id,
          username: admin.username,
          role: 'system_admin',
          exp: Date.now() + 24 * 60 * 60 * 1000
        };
        const token = 'mock_jwt_' + btoa(JSON.stringify(tokenPayload));

        return new Response(JSON.stringify({
          success: true,
          token,
          user: {
            id: admin.id,
            email: admin.username,
            mustChangePassword: !!admin.must_change_password
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0.B POST /auth/admin/change-password - 系统管理员修改密码
    if (url.pathname === '/auth/admin/change-password' && request.method === 'POST') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const { oldPassword, newPassword } = await request.json() as any;
        if (!newPassword || newPassword.length < 6) {
          return new Response(JSON.stringify({ error: 'New password must be at least 6 characters' }), { status: 400, headers: corsHeaders });
        }

        const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
        if (!admin) {
          return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: corsHeaders });
        }

        if (admin.password_hash) {
          const encoder = new TextEncoder();
          const data = encoder.encode(oldPassword);
          const hashBuffer = await crypto.subtle.digest('SHA-256', data);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          
          if (hashHex !== admin.password_hash) {
            return new Response(JSON.stringify({ error: 'Old password incorrect' }), { status: 401, headers: corsHeaders });
          }
        }

        const encoder = new TextEncoder();
        const data = encoder.encode(newPassword);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        await env.DB.prepare(
          'UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?'
        ).bind(hashHex, userId).run();

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0.2 GET /api/admin/articles - 文章搜索与过滤 (系统管理员)
    if (url.pathname === '/api/admin/articles' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
        if (!admin) {
          return new Response(JSON.stringify({ error: 'Forbidden: System Admin access required' }), { status: 403, headers: corsHeaders });
        }

        const search = url.searchParams.get('q') || '';
        const platform = url.searchParams.get('platform') || '';
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        let query = `
          SELECT a.id, a.title, a.publish_time, a.article_url, a.status, a.extra_info,
            ac.account_name, p.display_name as platform_name, p.icon as platform_icon, u.email as user_email,
            -- 计算该文章是该用户生成的第几篇（按发布时间升序排列）
            ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY a.publish_time ASC) as user_article_index
          FROM articles a 
          JOIN accounts ac ON a.account_id = ac.id 
          JOIN platforms p ON ac.platform_id = p.id 
          JOIN users u ON ac.user_id = u.id
          WHERE 1=1
        `;
        const params: any[] = [];

        if (search) {
          query += ` AND (u.email LIKE ? OR a.title LIKE ?)`;
          params.push(`%${search}%`, `%${search}%`);
        }

        if (platform) {
          query += ` AND p.name = ?`;
          params.push(platform);
        }

        query += ` ORDER BY a.publish_time DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const results = await env.DB.prepare(query).bind(...params).all();
        
        // Get total count for pagination
        let countQuery = `
          SELECT COUNT(*) as total
          FROM articles a 
          JOIN accounts ac ON a.account_id = ac.id 
          JOIN platforms p ON ac.platform_id = p.id 
          JOIN users u ON ac.user_id = u.id
          WHERE 1=1
        `;
        const countParams: any[] = [];
        
        if (search) {
          countQuery += ` AND (u.email LIKE ? OR a.title LIKE ?)`;
          countParams.push(`%${search}%`, `%${search}%`);
        }
        if (platform) {
          countQuery += ` AND p.name = ?`;
          countParams.push(platform);
        }
        
        const total = await env.DB.prepare(countQuery).bind(...countParams).first('total');

        // 解析每篇文章的 extra_info，提取 token 消耗数据
        const articles = (results.results || []).map((a: any) => {
          let extra: any = {};
          try { extra = JSON.parse(a.extra_info || '{}'); } catch {}
          return {
            ...a,
            extra_info: undefined, // 不直接暴露原始 JSON 字符串
            promptTokens: extra.promptTokens ?? null,
            completionTokens: extra.completionTokens ?? null,
            totalTokens: extra.totalTokens ?? null,
          };
        });

        return new Response(JSON.stringify({
          articles,
          total,
          limit,
          offset
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0.2.1 GET /api/user/articles - 文章搜索与过滤 (用户级)
    if (url.pathname === '/api/user/articles' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const search = url.searchParams.get('q') || '';
        const platform = url.searchParams.get('platform') || ''; // 单个平台（兼容旧版）
        const platforms = url.searchParams.get('platforms') || ''; // 多个平台（逗号分隔）
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        let query = `
          SELECT a.id, a.title, a.publish_time, a.article_url, a.status, a.extra_info,
            ac.account_name, p.display_name as platform_name, p.icon as platform_icon, p.name as platform_code
          FROM articles a 
          JOIN accounts ac ON a.account_id = ac.id 
          JOIN platforms p ON ac.platform_id = p.id 
          WHERE ac.user_id = ?
        `;
        const params: any[] = [userId];

        if (search) {
          query += ` AND a.title LIKE ?`;
          params.push(`%${search}%`);
        }

        // 支持多平台筛选（优先使用platforms参数）
        if (platforms) {
          const platformList = platforms.split(',').filter(p => p.trim());
          if (platformList.length > 0) {
            const placeholders = platformList.map(() => '?').join(',');
            query += ` AND p.name IN (${placeholders})`;
            params.push(...platformList);
          }
        } else if (platform) {
          // 兼容旧版单平台筛选
          query += ` AND p.name = ?`;
          params.push(platform);
        }

        query += ` ORDER BY a.publish_time DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const results = await env.DB.prepare(query).bind(...params).all();
        
        // Get total count for pagination
        let countQuery = `
          SELECT COUNT(*) as total
          FROM articles a 
          JOIN accounts ac ON a.account_id = ac.id 
          JOIN platforms p ON ac.platform_id = p.id 
          WHERE ac.user_id = ?
        `;
        const countParams: any[] = [userId];
        
        if (search) {
          countQuery += ` AND a.title LIKE ?`;
          countParams.push(`%${search}%`);
        }
        
        // 支持多平台筛选（优先使用platforms参数）
        if (platforms) {
          const platformList = platforms.split(',').filter(p => p.trim());
          if (platformList.length > 0) {
            const placeholders = platformList.map(() => '?').join(',');
            countQuery += ` AND p.name IN (${placeholders})`;
            countParams.push(...platformList);
          }
        } else if (platform) {
          // 兼容旧版单平台筛选
          countQuery += ` AND p.name = ?`;
          countParams.push(platform);
        }
        
        const total = await env.DB.prepare(countQuery).bind(...countParams).first('total');

        // 解析每篇文章的 extra_info，提取 token 消耗数据
        const articles = (results.results || []).map((a: any) => {
          let extra: any = {};
          try { extra = JSON.parse(a.extra_info || '{}'); } catch {}
          return {
            ...a,
            extra_info: undefined,
            promptTokens: extra.promptTokens ?? null,
            completionTokens: extra.completionTokens ?? null,
            totalTokens: extra.totalTokens ?? null,
          };
        });

        return new Response(JSON.stringify({
          articles,
          total
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0.3 GET /api/user/stats - 用户级统计数据
    if (url.pathname === '/api/user/stats' && request.method === 'GET') {
       try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const totalArticles = await env.DB.prepare('SELECT COUNT(*) as count FROM articles a JOIN accounts ac ON a.account_id = ac.id WHERE ac.user_id = ?').bind(userId).first('count');
        const totalReads = await env.DB.prepare('SELECT SUM(s.read_count) as count FROM article_stats s JOIN articles a ON s.article_id = a.id JOIN accounts ac ON a.account_id = ac.id WHERE ac.user_id = ?').bind(userId).first('count') || 0;
        const totalLikes = await env.DB.prepare('SELECT SUM(s.like_count) as count FROM article_stats s JOIN articles a ON s.article_id = a.id JOIN accounts ac ON a.account_id = ac.id WHERE ac.user_id = ?').bind(userId).first('count') || 0;
        const totalComments = await env.DB.prepare('SELECT SUM(s.comment_count) as count FROM article_stats s JOIN articles a ON s.article_id = a.id JOIN accounts ac ON a.account_id = ac.id WHERE ac.user_id = ?').bind(userId).first('count') || 0;
        const totalShares = await env.DB.prepare('SELECT SUM(s.share_count) as count FROM article_stats s JOIN articles a ON s.article_id = a.id JOIN accounts ac ON a.account_id = ac.id WHERE ac.user_id = ?').bind(userId).first('count') || 0;
        const totalCollects = await env.DB.prepare('SELECT SUM(s.collect_count) as count FROM article_stats s JOIN articles a ON s.article_id = a.id JOIN accounts ac ON a.account_id = ac.id WHERE ac.user_id = ?').bind(userId).first('count') || 0;

        return new Response(JSON.stringify({
            totalArticles,
            totalReads,
            totalLikes,
            totalComments,
            totalShares,
            totalCollects
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

       } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
       }
    }

    // 7.0.3 GET /api/admin/users - 用户列表与分页
    if (url.pathname === '/api/admin/users' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
        if (!admin) {
          return new Response(JSON.stringify({ error: 'Forbidden: System Admin access required' }), { status: 403, headers: corsHeaders });
        }

        const limit = parseInt(url.searchParams.get('limit') || '10');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const sort = url.searchParams.get('sort') || 'last_active'; // 默认按最后活跃排序
        const order = url.searchParams.get('order') || 'desc';
        const paidOnly = url.searchParams.get('paid_only') === '1'; // 是否仅看付费用户
        const newOnly = url.searchParams.get('new_only') === '1'; // 是否仅看新用户（当日注册）
        const keyword = url.searchParams.get('keyword') || ''; // 搜索关键词
        // 当前时间戳，用于计算3日/7日文章数和当日新增用户
        const now = Math.floor(Date.now() / 1000);
        // 计算今天0点的时间戳（使用中国时区 UTC+8）
        const nowDate = new Date();
        // 获取UTC时间并加8小时转换为中国时间
        const chinaOffset = 8 * 60 * 60; // 8小时的秒数
        const chinaTime = now + chinaOffset;
        // 计算中国时区今天0点的UTC时间戳
        const todayStart = Math.floor(chinaTime / 86400) * 86400 - chinaOffset;
        
        let query = `
          SELECT u.id, u.email, u.provider, u.created_at, MAX(a.publish_time) as last_active,
          q.paid_quota_remaining,
          -- 只统计文章生成次数（从 ai_usage_logs 中筛选 model = 'article-generation' 的记录）
          (SELECT COUNT(*) FROM ai_usage_logs WHERE (user_id = u.id OR anonymous_id = u.id) AND model = 'article-generation') as ai_usage,
          -- 最近3天生成文章数
          (SELECT COUNT(*) FROM articles a3 JOIN accounts ac3 ON a3.account_id = ac3.id WHERE ac3.user_id = u.id AND a3.publish_time >= ${now - 3 * 86400}) as articles_3d,
          -- 最近7天生成文章数
          (SELECT COUNT(*) FROM articles a7 JOIN accounts ac7 ON a7.account_id = ac7.id WHERE ac7.user_id = u.id AND a7.publish_time >= ${now - 7 * 86400}) as articles_7d,
          -- 总文章数
          (SELECT COUNT(*) FROM articles a_all JOIN accounts ac_all ON a_all.account_id = ac_all.id WHERE ac_all.user_id = u.id) as total_articles,
          -- 累计消耗token数量（从articles表的extra_info字段中提取totalTokens并求和）
          (SELECT COALESCE(SUM(
            CAST(json_extract(a_token.extra_info, '$.totalTokens') AS INTEGER)
          ), 0) 
          FROM articles a_token 
          JOIN accounts ac_token ON a_token.account_id = ac_token.id 
          WHERE ac_token.user_id = u.id 
          AND json_extract(a_token.extra_info, '$.totalTokens') IS NOT NULL) as total_tokens,
          -- 是否有已支付的充值记录（用于付费用户标识）
          (SELECT COUNT(*) FROM payment_orders po WHERE po.user_id = u.id AND po.status IN ('paid', 'approved')) as paid_count,
          -- 是否为当日新增用户（注册时间 >= 今天0点）
          CASE WHEN u.created_at >= ${todayStart} THEN 1 ELSE 0 END as is_new_today
          FROM users u
          LEFT JOIN user_quotas q ON u.id = q.user_id
          LEFT JOIN accounts ac ON u.id = ac.user_id
          LEFT JOIN articles a ON ac.id = a.account_id
        `;

        // 添加搜索条件：支持用户ID和邮箱前缀搜索
        if (keyword.trim()) {
          query += ` WHERE (u.id LIKE '%${keyword}%' OR u.email LIKE '${keyword}%')`;
        }

        query += ` GROUP BY u.id`;

        // 筛选条件：使用 HAVING 子句
        const havingConditions = [];
        
        // 仅看付费用户：过滤有充值记录的
        if (paidOnly) {
          havingConditions.push('paid_count > 0');
        }
        
        // 仅看新用户：过滤当日注册的用户
        if (newOnly) {
          havingConditions.push('is_new_today = 1');
        }
        
        if (havingConditions.length > 0) {
          query += ` HAVING ` + havingConditions.join(' AND ');
        }
        
        let sortField = 'last_active';
        if (sort === 'created_at') sortField = 'u.created_at';
        if (sort === 'last_active') sortField = 'last_active';
        if (sort === 'paid_quota') sortField = 'q.paid_quota_remaining';
        if (sort === 'articles_3d') sortField = 'articles_3d';
        if (sort === 'articles_7d') sortField = 'articles_7d';
        if (sort === 'total_tokens') sortField = 'total_tokens'; // 新增：支持按消耗token排序

        const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
        const nullsOrder = (sort === 'last_active' || sort === 'paid_quota') ? 'NULLS LAST' : '';

        query += ` ORDER BY ${sortField} ${sortOrder} ${nullsOrder}`;
        
        // Secondary sort for stable pagination
        if (sort !== 'created_at') {
             query += `, u.created_at DESC`;
        }

        query += ` LIMIT ? OFFSET ?`;

        const results = await env.DB.prepare(query).bind(limit, offset).all();

        // 总数：需要考虑搜索条件、付费筛选和新用户筛选
        let totalQuery = 'SELECT COUNT(*) as total FROM users u';
        if (keyword.trim() || paidOnly || newOnly) {
          totalQuery = 'SELECT COUNT(*) as total FROM users u';
          const conditions = [];
          
          // 搜索条件
          if (keyword.trim()) {
            conditions.push(`(u.id LIKE '%${keyword}%' OR u.email LIKE '${keyword}%')`);
          }
          
          // 付费用户筛选
          if (paidOnly) {
            conditions.push(`EXISTS (SELECT 1 FROM payment_orders po WHERE po.user_id = u.id AND po.status IN ('paid', 'approved'))`);
          }
          
          // 新用户筛选（当日注册）
          if (newOnly) {
            conditions.push(`u.created_at >= ${todayStart}`);
          }
          
          if (conditions.length > 0) {
            totalQuery += ' WHERE ' + conditions.join(' AND ');
          }
        }
        const total = await env.DB.prepare(totalQuery).first('total');

        return new Response(JSON.stringify({
          users: results.results,
          total,
          limit,
          offset
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0 GET /api/admin/system-stats - 获取系统级统计数据
    if (url.pathname === '/api/admin/system-stats' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
        if (!admin) {
          return new Response(JSON.stringify({ error: 'Forbidden: System Admin access required' }), { status: 403, headers: corsHeaders });
        }

        const totalUsers = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first('count');
        const totalArticles = await env.DB.prepare('SELECT COUNT(*) as count FROM articles').first('count');
        const totalAccounts = await env.DB.prepare('SELECT COUNT(*) as count FROM accounts').first('count');

        const platformStats = await env.DB.prepare(`
          SELECT p.display_name, p.name, p.icon, COUNT(a.id) as count 
          FROM articles a 
          JOIN accounts ac ON a.account_id = ac.id 
          JOIN platforms p ON ac.platform_id = p.id 
          WHERE p.name != 'test'
          GROUP BY p.name
        `).all();

        const recentUsers = await env.DB.prepare(`
          SELECT u.id, u.email, u.provider, u.created_at, 
                 q.free_quota_remaining, 
                 q.paid_quota_remaining,
                 MAX(a.publish_time) as last_active
          FROM users u
          LEFT JOIN user_quotas q ON u.id = q.user_id
          LEFT JOIN accounts ac ON u.id = ac.user_id
          LEFT JOIN articles a ON ac.id = a.account_id
          GROUP BY u.id
          ORDER BY u.created_at DESC 
          LIMIT 10
        `).all();

        const recentArticles = await env.DB.prepare(`
          SELECT a.title, a.publish_time, a.article_url, a.status, ac.account_name, p.display_name as platform_name, p.icon as platform_icon 
          FROM articles a 
          JOIN accounts ac ON a.account_id = ac.id 
          JOIN platforms p ON ac.platform_id = p.id 
          ORDER BY a.publish_time DESC 
          LIMIT 20
        `).all();

        // Calculate today's stats (UTC+8 start of day)
        const now = Math.floor(Date.now() / 1000);
        const offset = 8 * 60 * 60; // UTC+8 offset in seconds
        const startOfDay = now - ((now + offset) % 86400);
        
        const newUsersToday = await env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE created_at >= ?').bind(startOfDay).first('count');
        const newArticlesToday = await env.DB.prepare('SELECT COUNT(*) as count FROM articles WHERE publish_time >= ?').bind(startOfDay).first('count');
        
        // Active users: published an article today (UTC+8)
        const activeUsersToday = await env.DB.prepare(`
          SELECT COUNT(DISTINCT u.id) as count 
          FROM users u
          JOIN accounts ac ON u.id = ac.user_id
          JOIN articles a ON ac.id = a.account_id
          WHERE a.publish_time >= ?
        `).bind(startOfDay).first('count');

        // Recharge metrics (UTC+8)
        const todayRechargeAmount = await env.DB.prepare('SELECT SUM(amount) as sum FROM payment_orders WHERE paid_at >= ? AND status = ?').bind(startOfDay, 'paid').first('sum') || 0;
        const todayRechargeCount = await env.DB.prepare('SELECT COUNT(*) as count FROM payment_orders WHERE paid_at >= ? AND status = ?').bind(startOfDay, 'paid').first('count') || 0;
        const totalRechargeAmount = await env.DB.prepare('SELECT SUM(amount) as sum FROM payment_orders WHERE status = ?').bind('paid').first('sum') || 0;
        const pendingOrderCount = await env.DB.prepare('SELECT COUNT(*) as count FROM payment_orders WHERE status = ?').bind('pending').first('count') || 0;

        return new Response(JSON.stringify({
          overview: {
            users: totalUsers,
            articles: totalArticles,
            accounts: totalAccounts,
            activeUsersToday,
            newUsersToday,
            newArticlesToday,
            todayRechargeAmount,
            todayRechargeCount,
            totalRechargeAmount,
            pendingOrderCount
          },
          platforms: platformStats.results,
          recentUsers: recentUsers.results,
          recentArticles: recentArticles.results
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0.0.1 GET /api/admin/trends - 获取最近30天每日趋势数据（活跃用户、新增用户、生成文章、充值金额）
    if (url.pathname === '/api/admin/trends' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }
        const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
        if (!admin) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
        }

        // 查询类型：activeUsers / newUsers / newArticles / rechargeAmount
        const type = url.searchParams.get('type') || 'activeUsers';
        const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 90);

        // 计算UTC+8的今天起始时间戳
        const now = Math.floor(Date.now() / 1000);
        const utc8Offset = 8 * 60 * 60;
        const todayStart = now - ((now + utc8Offset) % 86400);
        // 从 (days-1) 天前开始，到今天
        const startTs = todayStart - (days - 1) * 86400;

        // 生成日期标签数组（用于补齐无数据的日期）
        const dateLabels: string[] = [];
        for (let i = 0; i < days; i++) {
          const ts = startTs + i * 86400 + utc8Offset; // 转为UTC+8的时间
          const d = new Date(ts * 1000);
          dateLabels.push(`${d.getMonth() + 1}/${d.getDate()}`);
        }

        let dataMap: Record<string, number> = {};

        if (type === 'activeUsers') {
          // 每天有文章发布的独立用户数
          const rows = await env.DB.prepare(`
            SELECT ((a.publish_time + ${utc8Offset}) / 86400) as day_key, COUNT(DISTINCT u.id) as cnt
            FROM articles a
            JOIN accounts ac ON a.account_id = ac.id
            JOIN users u ON ac.user_id = u.id
            WHERE a.publish_time >= ?
            GROUP BY day_key
          `).bind(startTs).all();
          for (const r of rows.results as any[]) {
            const ts = r.day_key * 86400; // 还原为UTC+8的0点时间戳
            const d = new Date(ts * 1000);
            const label = `${d.getMonth() + 1}/${d.getDate()}`;
            dataMap[label] = r.cnt;
          }
        } else if (type === 'newUsers') {
          // 每天新注册用户数
          const rows = await env.DB.prepare(`
            SELECT ((created_at + ${utc8Offset}) / 86400) as day_key, COUNT(*) as cnt
            FROM users
            WHERE created_at >= ?
            GROUP BY day_key
          `).bind(startTs).all();
          for (const r of rows.results as any[]) {
            const ts = r.day_key * 86400;
            const d = new Date(ts * 1000);
            const label = `${d.getMonth() + 1}/${d.getDate()}`;
            dataMap[label] = r.cnt;
          }
        } else if (type === 'newArticles') {
          // 每天生成文章数
          const rows = await env.DB.prepare(`
            SELECT ((publish_time + ${utc8Offset}) / 86400) as day_key, COUNT(*) as cnt
            FROM articles
            WHERE publish_time >= ?
            GROUP BY day_key
          `).bind(startTs).all();
          for (const r of rows.results as any[]) {
            const ts = r.day_key * 86400;
            const d = new Date(ts * 1000);
            const label = `${d.getMonth() + 1}/${d.getDate()}`;
            dataMap[label] = r.cnt;
          }
        } else if (type === 'rechargeAmount') {
          // 每天充值金额（已支付）
          const rows = await env.DB.prepare(`
            SELECT ((paid_at + ${utc8Offset}) / 86400) as day_key, SUM(amount) as total
            FROM payment_orders
            WHERE paid_at >= ? AND status = 'paid'
            GROUP BY day_key
          `).bind(startTs).all();
          for (const r of rows.results as any[]) {
            const ts = r.day_key * 86400;
            const d = new Date(ts * 1000);
            const label = `${d.getMonth() + 1}/${d.getDate()}`;
            dataMap[label] = r.total;
          }
        }

        // 按日期顺序输出，无数据的日期补0
        const values = dateLabels.map(label => dataMap[label] || 0);

        return new Response(JSON.stringify({
          labels: dateLabels,
          values,
          type
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0.0.1.1 GET /api/admin/platform-trends - 获取各平台每日文章数量趋势（多条折线）
    if (url.pathname === '/api/admin/platform-trends' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }
        const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
        if (!admin) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
        }

        const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 90);

        // 计算UTC+8的今天起始时间戳
        const now = Math.floor(Date.now() / 1000);
        const utc8Offset = 8 * 60 * 60;
        const todayStart = now - ((now + utc8Offset) % 86400);
        const startTs = todayStart - (days - 1) * 86400;

        // 生成日期标签数组
        const dateLabels: string[] = [];
        for (let i = 0; i < days; i++) {
          const ts = startTs + i * 86400 + utc8Offset;
          const d = new Date(ts * 1000);
          dateLabels.push(`${d.getMonth() + 1}/${d.getDate()}`);
        }

        // 查询各平台每日文章数（排除test平台）
        // 需要通过 articles -> accounts -> platforms 三表关联
        const rows = await env.DB.prepare(`
          SELECT 
            p.name as platform_name,
            p.display_name,
            ((a.publish_time + ${utc8Offset}) / 86400) as day_key,
            COUNT(*) as cnt
          FROM articles a
          JOIN accounts ac ON a.account_id = ac.id
          JOIN platforms p ON ac.platform_id = p.id
          WHERE a.publish_time >= ? AND p.name != 'test'
          GROUP BY p.name, p.display_name, day_key
          ORDER BY p.name, day_key
        `).bind(startTs).all();

        // 按平台组织数据
        const platformData: Record<string, { name: string; displayName: string; values: number[] }> = {};
        
        for (const r of rows.results as any[]) {
          const ts = r.day_key * 86400;
          const d = new Date(ts * 1000);
          const label = `${d.getMonth() + 1}/${d.getDate()}`;
          
          if (!platformData[r.platform_name]) {
            platformData[r.platform_name] = {
              name: r.platform_name,
              displayName: r.display_name,
              values: new Array(days).fill(0)
            };
          }
          
          const dayIndex = dateLabels.indexOf(label);
          if (dayIndex >= 0) {
            platformData[r.platform_name].values[dayIndex] = r.cnt;
          }
        }

        // 转换为数组格式
        const platforms = Object.values(platformData);

        return new Response(JSON.stringify({
          labels: dateLabels,
          platforms
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0.0.2 GET /api/admin/leaderboards - 获取排行榜数据（文章数、Token消耗、充值金额）
    if (url.pathname === '/api/admin/leaderboards' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
        if (!admin) {
          return new Response(JSON.stringify({ error: 'Forbidden: Admin access required' }), { status: 403, headers: corsHeaders });
        }

        const limit = parseInt(url.searchParams.get('limit') || '10');

        // 1. 文章数量排行榜 - 统计每个用户生成的文章总数
        const articlesLeaderboard = await env.DB.prepare(`
          SELECT 
            u.email,
            u.provider,
            COUNT(a.id) as article_count,
            MAX(a.publish_time) as last_publish_time
          FROM users u
          LEFT JOIN accounts acc ON acc.user_id = u.id
          LEFT JOIN articles a ON a.account_id = acc.id
          GROUP BY u.id
          HAVING article_count > 0
          ORDER BY article_count DESC
          LIMIT ?
        `).bind(limit).all();

        // 2. Token 消耗排行榜 - 统计每个用户消耗的总 Token 数
        // 从 articles.extra_info 中提取 totalTokens 并求和
        const tokenLeaderboard = await env.DB.prepare(`
          SELECT 
            u.email,
            u.provider,
            COUNT(a.id) as article_count,
            SUM(
              CAST(
                json_extract(a.extra_info, '$.totalTokens') AS INTEGER
              )
            ) as total_tokens
          FROM users u
          LEFT JOIN accounts acc ON acc.user_id = u.id
          LEFT JOIN articles a ON a.account_id = acc.id
          WHERE json_extract(a.extra_info, '$.totalTokens') IS NOT NULL
          GROUP BY u.id
          HAVING total_tokens > 0
          ORDER BY total_tokens DESC
          LIMIT ?
        `).bind(limit).all();

        // 3. 充值金额排行榜 - 统计每个用户的累计充值金额
        const rechargeLeaderboard = await env.DB.prepare(`
          SELECT 
            u.email,
            u.provider,
            SUM(po.amount) as total_amount,
            COUNT(po.id) as order_count,
            MAX(po.paid_at) as last_recharge_time
          FROM users u
          LEFT JOIN payment_orders po ON po.user_id = u.id
          WHERE po.status = 'paid'
          GROUP BY u.id
          HAVING total_amount > 0
          ORDER BY total_amount DESC
          LIMIT ?
        `).bind(limit).all();

        return new Response(JSON.stringify({
          articles: articlesLeaderboard.results || [],
          tokens: tokenLeaderboard.results || [],
          recharge: rechargeLeaderboard.results || []
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0.0.3 GET /api/admin/feedback - 获取用户反馈列表
    if (url.pathname === '/api/admin/feedback' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
        if (!admin) {
          return new Response(JSON.stringify({ error: 'Forbidden: Admin access required' }), { status: 403, headers: corsHeaders });
        }

        // 获取查询参数
        const page = parseInt(url.searchParams.get('page') || '1');
        const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
        const status = url.searchParams.get('status') || 'all'; // all, pending, resolved, ignored
        const type = url.searchParams.get('type') || 'all'; // all, experience, suggestion, bug
        const offset = (page - 1) * pageSize;

        // 构建查询条件
        let whereConditions = [];
        let params: any[] = [];

        if (status !== 'all') {
          whereConditions.push('f.status = ?');
          params.push(status);
        }

        if (type !== 'all') {
          whereConditions.push('f.type = ?');
          params.push(type);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // 查询反馈列表
        const feedbackQuery = `
          SELECT 
            f.id,
            f.user_id,
            f.user_email,
            f.type,
            f.content,
            f.status,
            f.admin_reply,
            f.created_at,
            f.updated_at,
            u.email as user_email_from_users
          FROM feedback f
          LEFT JOIN users u ON f.user_id = u.id
          ${whereClause}
          ORDER BY f.created_at DESC
          LIMIT ? OFFSET ?
        `;

        const feedbackList = await env.DB.prepare(feedbackQuery)
          .bind(...params, pageSize, offset)
          .all();

        // 查询总数
        const countQuery = `SELECT COUNT(*) as total FROM feedback f ${whereClause}`;
        const countResult = await env.DB.prepare(countQuery).bind(...params).first();
        const total = countResult?.total || 0;

        return new Response(JSON.stringify({
          list: feedbackList.results || [],
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize)
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e: any) {
        console.error('Feedback list error:', e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0.0.4 POST /api/admin/feedback/:id/status - 更新反馈状态
    if (url.pathname.match(/^\/api\/admin\/feedback\/\d+\/status$/) && request.method === 'POST') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
        if (!admin) {
          return new Response(JSON.stringify({ error: 'Forbidden: Admin access required' }), { status: 403, headers: corsHeaders });
        }

        const feedbackId = url.pathname.split('/')[4];
        const body = await request.json() as any;
        const { status, adminReply } = body;

        // 验证状态值
        if (!['pending', 'resolved', 'ignored'].includes(status)) {
          return new Response(JSON.stringify({ error: '无效的状态值' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 更新反馈状态
        await env.DB.prepare(
          `UPDATE feedback SET status = ?, admin_reply = ?, updated_at = ? WHERE id = ?`
        ).bind(status, adminReply || null, Math.floor(Date.now() / 1000), feedbackId).run();

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (e: any) {
        console.error('Update feedback status error:', e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7.0.1 GET /admin - 系统管理后台页面
    if (url.pathname === '/admin' && request.method === 'GET') {
      const ASSETS_BASE = effectiveOrigin + '/assets/memoraid';
      const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Memoraid · 系统管理后台</title>
    <link rel="icon" type="image/png" href="${ASSETS_BASE}/icon-128.png">
    <style>
        :root {
            --bg: #ffffff;
            --bg-subtle: #f8fafc;
            --bg-muted: #f3f4f6;
            --surface: #ffffff;
            --border: #e5e7eb;
            --border-light: #eef2f7;
            --text: #0f172a;
            --text-secondary: #334155;
            --text-muted: #64748b;
            --accent: #111827;
            --accent-secondary: #10b981;
            --gradient-1: linear-gradient(135deg, rgba(16,185,129,.18) 0%, rgba(167,139,250,.14) 100%);
            --gradient-2: linear-gradient(135deg, #111827 0%, #0f172a 100%);
            --shadow: 0 8px 24px rgba(2, 6, 23, 0.08);
            --radius: 12px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', 'Noto Sans SC', system-ui, sans-serif;
            background: var(--bg);
            color: var(--text);
            height: 100vh;
            overflow: hidden;
            line-height: 1.6;
        }
        
        /* Layout */
        .layout { display: flex; height: 100%; }
        .sidebar { 
            width: 260px; background: var(--surface); border-right: 1px solid var(--border); 
            display: flex; flex-direction: column; flex-shrink: 0; z-index: 10;
        }
        .sidebar-header { 
            height: 72px; display: flex; align-items: center; padding: 0 24px; 
            border-bottom: 1px solid var(--border); 
        }
        .logo { font-size: 1.25rem; font-weight: 700; display: flex; align-items: center; gap: 12px; color: var(--text); text-decoration: none; }
        .logo img { width: 32px; height: 32px; border-radius: 8px; }
        
        .sidebar-nav { padding: 24px 16px; flex: 1; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
        .nav-item { 
            display: flex; align-items: center; gap: 12px; padding: 12px 16px; 
            border-radius: 8px; color: var(--text-secondary); cursor: pointer; 
            text-decoration: none; font-weight: 500; transition: all 0.2s; 
        }
        .nav-item:hover { background: var(--bg-muted); color: var(--text); }
        .nav-item.active { background: var(--bg-subtle); color: var(--accent); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        
        .main-content { flex: 1; overflow-y: auto; background: var(--bg-subtle); position: relative; }
        .content-body { padding: 32px; max-width: 1600px; margin: 0 auto; width: 100%; }
        
        /* Components */
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; margin-bottom: 40px; }
        .stat-card {
            background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px;
            transition: transform 0.2s; box-shadow: var(--shadow);
        }
        .stat-card:hover { transform: translateY(-2px); border-color: var(--accent); }
        .stat-label { color: var(--text-muted); font-size: 0.875rem; font-weight: 500; margin-bottom: 8px; }
        .stat-value { font-size: 2.5rem; font-weight: 700; color: var(--text); line-height: 1; }
        
        .section-title { font-size: 1.5rem; font-weight: 700; margin-bottom: 24px; color: var(--text); display: flex; align-items: center; gap: 10px; }
        
        .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); margin-bottom: 24px; }
        .table-wrapper { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 16px 24px; background: var(--bg-subtle); color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); white-space: nowrap; }
        td { padding: 16px 24px; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-size: 0.875rem; white-space: nowrap; }
        .truncate-title { max-width: 300px; overflow: hidden; text-overflow: ellipsis; display: block; }
        tr:last-child td { border-bottom: none; }
        tr:hover { background: var(--bg-subtle); }
        
        .user-cell { display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .user-cell:hover .user-email { color: var(--accent-secondary); text-decoration: underline; }
        .avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--bg-muted); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: var(--text-muted); font-weight: bold; }
        
        .status-pill { padding: 2px 10px; border-radius: 100px; font-size: 0.75rem; font-weight: 500; }
        .status-pill.published { background: rgba(16, 185, 129, 0.1); color: #059669; }
        .status-pill.generated { background: rgba(56, 189, 248, 0.1); color: #0284c7; }
        .status-pill.pending { background: rgba(251, 191, 36, 0.1); color: #d97706; }
        .status-pill.paid { background: rgba(16, 185, 129, 0.1); color: #059669; }
        .status-pill.cancelled { background: rgba(244, 63, 94, 0.1); color: #e11d48; }
        
        .platform-list { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); 
            gap: 16px; padding: 24px; 
        }
        .platform-item { 
            background: var(--bg); padding: 16px; border-radius: 8px; text-align: center; border: 1px solid var(--border); 
            cursor: pointer; transition: all 0.2s;
        }
        .platform-item:hover { border-color: var(--accent); background: var(--bg-subtle); }
        .platform-item.active { border-color: var(--accent); background: var(--bg-subtle); box-shadow: 0 0 0 2px var(--accent-secondary); }
        .platform-icon { font-size: 1.5rem; margin-bottom: 8px; }
        .platform-count { font-size: 1.25rem; font-weight: 700; color: var(--text); }
        .platform-name { font-size: 0.75rem; color: var(--text-muted); }

        .toolbar {
            display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; align-items: center;
        }
        .form-input {
            padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.875rem;
            background: var(--surface); color: var(--text); min-width: 200px;
        }
        .form-select {
            padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.875rem;
            background: var(--surface); color: var(--text);
        }
        .btn-sm {
            padding: 8px 16px; background: var(--accent); color: white; border: none; border-radius: 6px;
            cursor: pointer; font-size: 0.875rem; font-weight: 500;
        }
        .btn-sm:hover { opacity: 0.9; }
        .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
        .btn-outline:hover { background: var(--bg-muted); }
        .btn-danger { background: #e11d48; color: white; }
        .btn-success { background: #059669; color: white; }

        /* 排行榜样式 - 添加hover效果 */
        .leaderboard-item:hover {
            transform: translateX(4px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        /* Loading & Error - Centered */
        .loading { 
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            text-align: center; color: var(--text-muted); z-index: 100;
        }
        .error-msg { 
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            color: #f43f5e; padding: 20px; text-align: center; 
            background: rgba(244, 63, 94, 0.1); border-radius: 8px; 
            z-index: 100; max-width: 80%;
        }
        
        /* Modal Styles */
        .modal-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center;
            z-index: 1000; backdrop-filter: blur(4px);
        }
        .modal {
            background: var(--surface); padding: 32px; border-radius: var(--radius);
            width: 90%; max-width: 400px; border: 1px solid var(--border);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
        .modal-title { font-size: 1.5rem; font-weight: 700; margin-bottom: 24px; text-align: center; color: var(--text); }
        .form-group { margin-bottom: 16px; }
        .form-label { display: block; margin-bottom: 8px; font-size: 0.875rem; color: var(--text-secondary); }
        .modal-input {
            width: 100%; padding: 12px; background: var(--bg); border: 1px solid var(--border);
            border-radius: 6px; color: var(--text); font-size: 1rem;
            transition: border-color 0.2s;
        }
        .modal-input:focus { outline: none; border-color: var(--accent); }
        .btn-primary {
            width: 100%; padding: 12px; background: var(--accent); color: white; font-weight: 600;
            border: none; border-radius: 6px; cursor: pointer; transition: opacity 0.2s;
            margin-top: 8px;
        }
        .btn-primary:hover { opacity: 0.9; }
        .modal-error { color: #f43f5e; font-size: 0.875rem; margin-top: 12px; text-align: center; display: none; }
        
        .sortable { cursor: pointer; user-select: none; }
        .sortable:hover { color: var(--text); }
        .sortable.active { color: var(--accent); font-weight: 700; }
        .sortable.active::after { content: ' ↓'; margin-left: 2px; }
        .sortable.asc::after { content: ' ↑'; }
        
        .tab-content { display: none; animation: fadeIn 0.3s ease; }
        .tab-content.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    </style>
</head>
<body>
    <div id="loading" class="loading">正在加载系统数据...</div>
    <div id="globalError" class="error-msg" style="display:none"></div>

    <div class="layout" id="mainLayout" style="display:none">
        <aside class="sidebar">
            <div class="sidebar-header">
                <a href="/admin" class="logo">
                    <img src="${ASSETS_BASE}/icon-128.png" alt="Logo">
                    Memoraid
                </a>
            </div>
            <nav class="sidebar-nav">
                <a href="#dashboard" class="nav-item active" id="nav-dashboard" onclick="switchTab('dashboard')">
                    <span>📊</span> 仪表盘
                </a>
                <a href="#users" class="nav-item" id="nav-users" onclick="switchTab('users')">
                    <span>👥</span> 用户管理
                </a>
                <a href="#articles" class="nav-item" id="nav-articles" onclick="switchTab('articles')">
                    <span>📝</span> 文章管理
                </a>
                <a href="#orders" class="nav-item" id="nav-orders" onclick="switchTab('orders')">
                    <span>💰</span> 支付记录
                </a>
                <!-- 排行榜导航项 - 移到支付记录下面 -->
                <a href="#leaderboards" class="nav-item" id="nav-leaderboards" onclick="switchTab('leaderboards')">
                    <span>🏆</span> 排行榜
                </a>
                <!-- 用户反馈导航项 -->
                <a href="#feedback" class="nav-item" id="nav-feedback" onclick="switchTab('feedback')">
                    <span>💬</span> 用户反馈
                </a>
                <a href="#settings" class="nav-item" id="nav-settings" onclick="switchTab('settings')">
                    <span>⚙️</span> 系统设置
                </a>
            </nav>
            <div style="padding: 24px;">
                <button id="logoutBtn" onclick="logout()" class="btn-sm btn-outline" style="width: 100%;">退出登录</button>
            </div>
        </aside>
        
        <main class="main-content">
            <div class="content-body">
                <div id="error" style="display:none" class="error-msg"></div>

                <div id="tab-dashboard" class="tab-content" style="display:none">
            <div class="stats-grid">
                <!-- 点击卡片可查看历史趋势曲线 -->
                <div class="stat-card" style="cursor:pointer" onclick="showTrendChart('activeUsers', '今日活跃用户')">
                    <div class="stat-label">今日活跃用户</div>
                    <div class="stat-value" id="activeUsersToday">-</div>
                </div>
                <div class="stat-card" style="cursor:pointer" onclick="showTrendChart('newUsers', '今日新增用户')">
                    <div class="stat-label">今日新增用户</div>
                    <div class="stat-value" id="newUsersToday">-</div>
                </div>
                <div class="stat-card" style="cursor:pointer" onclick="showTrendChart('newArticles', '今日生成文章')">
                    <div class="stat-label">今日生成文章</div>
                    <div class="stat-value" id="newArticlesToday">-</div>
                </div>
                <div class="stat-card" style="cursor:pointer" onclick="showTrendChart('rechargeAmount', '今日充值金额')">
                    <div class="stat-label">今日充值金额</div>
                    <div class="stat-value" id="todayRechargeAmount">-</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">今日充值笔数</div>
                    <div class="stat-value" id="todayRechargeCount">-</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">累计充值金额</div>
                    <div class="stat-value" id="totalRechargeAmount">-</div>
                </div>
                <div class="stat-card" style="cursor:pointer" onclick="goToPendingOrders()">
                    <div class="stat-label">待支付订单</div>
                    <div class="stat-value" id="pendingOrderCount" style="color:#d97706">-</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">总用户数</div>
                    <div class="stat-value" id="totalUsers">-</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">总文章生成</div>
                    <div class="stat-value" id="totalArticles">-</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">绑定账号数</div>
                    <div class="stat-value" id="totalAccounts">-</div>
                </div>
            </div>

            <!-- 趋势图模态框 -->
            <div id="trendModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);align-items:center;justify-content:center">
                <div style="background:var(--surface);border-radius:var(--radius-lg);padding:32px;max-width:800px;width:90%;box-shadow:var(--shadow-lg);position:relative">
                    <button onclick="closeTrendModal()" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-muted);line-height:1">&times;</button>
                    <h3 id="trendTitle" style="margin-bottom:8px;font-size:1.25rem;color:var(--text)"></h3>
                    <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:20px">最近30天趋势</p>
                    <div style="position:relative;width:100%;height:300px">
                        <canvas id="trendCanvas" style="width:100%;height:100%"></canvas>
                    </div>
                    <!-- 趋势图底部的汇总信息 -->
                    <div id="trendSummary" style="display:flex;gap:24px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border);font-size:0.85rem;color:var(--text-secondary)"></div>
                </div>
            </div>

            <div class="section">
                <h2 class="section-title">📊 平台内容分布</h2>
                <div class="card">
                    <div class="platform-list" id="platformStats"></div>
                </div>
                
                <!-- 平台文章数量趋势图 -->
                <div class="card" style="padding:20px;margin-top:16px;position:relative">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                        <h3 style="font-size:0.95rem;color:var(--text-secondary);margin:0">📈 各平台每日文章数量</h3>
                        <!-- 时间范围切换按钮 -->
                        <div style="display:flex;gap:6px">
                            <button class="btn-sm btn-outline" onclick="switchPlatformChartRange(7)" id="platformRangeBtn7">近7天</button>
                            <button class="btn-sm btn-outline active" onclick="switchPlatformChartRange(30)" id="platformRangeBtn30" style="background:var(--accent);color:#fff">近30天</button>
                            <button class="btn-sm btn-outline" onclick="switchPlatformChartRange(90)" id="platformRangeBtn90">近90天</button>
                        </div>
                    </div>
                    <div style="position:relative;width:100%;height:320px">
                        <canvas id="platformTrendsChart" style="width:100%;height:100%"></canvas>
                        <!-- Tooltip提示框 - 添加过渡动画 -->
                        <div id="platformTooltip" style="position:absolute;display:none;background:rgba(0,0,0,0.85);color:#fff;padding:8px 12px;border-radius:6px;font-size:12px;pointer-events:none;z-index:1000;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.2);transition:opacity 0.15s ease,transform 0.15s ease;opacity:0"></div>
                    </div>
                    <!-- 图例 -->
                    <div id="platformLegend" style="display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;justify-content:center"></div>
                </div>
            </div>

            <!-- 历史趋势图表区域：活跃用户 + 生成文章 并列 -->
            <div class="section">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
                    <h2 class="section-title" style="margin-bottom:0">📈 数据趋势</h2>
                    <!-- 时间范围切换按钮组 -->
                    <div id="chartRangeBtns" style="display:flex;gap:6px">
                        <button class="btn-sm btn-outline" onclick="switchChartRange(7)" id="rangeBtn7">近7天</button>
                        <button class="btn-sm btn-outline active" onclick="switchChartRange(30)" id="rangeBtn30" style="background:var(--accent);color:#fff">近30天</button>
                        <button class="btn-sm btn-outline" onclick="switchChartRange(90)" id="rangeBtn90">近90天</button>
                    </div>
                </div>
                <!-- 第一行：活跃用户 + 生成文章 -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px">
                    <!-- 活跃用户折线图 -->
                    <div class="card" style="padding:20px">
                        <h3 style="font-size:0.95rem;color:var(--text-secondary);margin-bottom:12px">👥 每日活跃用户</h3>
                        <div style="position:relative;width:100%;height:240px">
                            <canvas id="dashActiveChart" style="width:100%;height:100%"></canvas>
                        </div>
                    </div>
                    <!-- 生成文章折线图 -->
                    <div class="card" style="padding:20px">
                        <h3 style="font-size:0.95rem;color:var(--text-secondary);margin-bottom:12px">📝 每日生成文章</h3>
                        <div style="position:relative;width:100%;height:240px">
                            <canvas id="dashArticlesChart" style="width:100%;height:100%"></canvas>
                        </div>
                    </div>
                </div>
                <!-- 第二行：新增用户 + 充值金额 -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
                    <!-- 新增用户折线图 -->
                    <div class="card" style="padding:20px">
                        <h3 style="font-size:0.95rem;color:var(--text-secondary);margin-bottom:12px">🆕 每日新增用户</h3>
                        <div style="position:relative;width:100%;height:240px">
                            <canvas id="dashNewUsersChart" style="width:100%;height:100%"></canvas>
                        </div>
                    </div>
                    <!-- 充值金额折线图 -->
                    <div class="card" style="padding:20px">
                        <h3 style="font-size:0.95rem;color:var(--text-secondary);margin-bottom:12px">💰 每日充值金额</h3>
                        <div style="position:relative;width:100%;height:240px">
                            <canvas id="dashRechargeChart" style="width:100%;height:100%"></canvas>
                        </div>
                    </div>
                </div>
            </div>
            </div> <!-- End tab-dashboard -->

            <!-- Users Tab -->
            <div id="tab-users" class="tab-content" style="display:none">
                <div class="section">
                    <h2 class="section-title">👥 用户管理 <span style="font-size:0.9rem;color:var(--text-muted);font-weight:400;margin-left:auto">总数: <span id="userCountBadge">-</span></span></h2>
                    <!-- 工具栏：搜索框 + 付费用户筛选按钮 -->
                    <div style="margin-bottom:12px;display:flex;gap:12px;align-items:center">
                        <input 
                            type="text" 
                            id="userSearchInput" 
                            placeholder="🔍 搜索用户ID或邮箱前缀..." 
                            style="flex:1;max-width:300px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem"
                            onkeyup="handleUserSearch(event)"
                        />
                        <button id="paidFilterBtn" class="btn-sm btn-outline" onclick="togglePaidFilter()" style="font-size:0.8rem">💰 仅看付费用户</button>
                        <button id="newFilterBtn" class="btn-sm btn-outline" onclick="toggleNewFilter()" style="font-size:0.8rem">🆕 仅看新用户</button>
                    </div>
                    <div class="card">
                        <div class="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>用户</th>
                                        <th>来源</th>
                                        <th title="文章生成使用次数">免费额度</th>
                                        <th class="sortable" id="sort-paid_quota" onclick="toggleSort('paid_quota')">付费额度</th>
                                        <!-- 新增：3日/7日文章数，支持排序 -->
                                        <th class="sortable" id="sort-articles_3d" onclick="toggleSort('articles_3d')" title="最近3天生成的文章数量">3日文章</th>
                                        <th class="sortable" id="sort-articles_7d" onclick="toggleSort('articles_7d')" title="最近7天生成的文章数量">7日文章</th>
                                        <!-- 新增：消耗TOKEN，支持排序 -->
                                        <th class="sortable" id="sort-total_tokens" onclick="toggleSort('total_tokens')" title="累计消耗的AI Token数量">消耗TOKEN</th>
                                        <th class="sortable" id="sort-created_at" onclick="toggleSort('created_at')">注册时间</th>
                                        <th class="sortable active" id="sort-last_active" onclick="toggleSort('last_active')">最后活跃</th>
                                    </tr>
                                </thead>
                                <tbody id="recentUsers"></tbody>
                            </table>
                        </div>
                        <div style="padding:12px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border)">
                            <button id="prevUsersBtn" class="btn-sm btn-outline" disabled onclick="changeUserPage(-1)">上一页</button>
                            <span id="userPageInfo" style="font-size:0.875rem;color:var(--text-muted)"></span>
                            <button id="nextUsersBtn" class="btn-sm btn-outline" disabled onclick="changeUserPage(1)">下一页</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Articles Tab -->
            <div id="tab-articles" class="tab-content" style="display:none">
                <div class="section">
                    <h2 class="section-title">📝 文章管理</h2>
                    <div class="toolbar">
                        <input type="text" id="searchInput" class="form-input" placeholder="搜索文章标题或用户邮箱...">
                        <select id="platformFilter" class="form-select">
                            <option value="">所有平台</option>
                        </select>
                        <button onclick="resetFilters()" class="btn-sm btn-outline">重置</button>
                        <span id="resultCount" style="margin-left:auto;align-self:center;color:var(--text-muted);font-size:0.875rem"></span>
                    </div>
                    <div class="card">
                        <div class="table-wrapper">
                            <table>
                                <!-- 新增 Token 列，显示每篇文章的 AI token 消耗 -->
                                <thead><tr><th>标题</th><th>平台</th><th>状态</th><th>用户</th><th>第几篇</th><th>Token</th><th>时间</th></tr></thead>
                                <tbody id="articlesTable"></tbody>
                            </table>
                        </div>
                        <div style="padding:12px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border)">
                            <button id="prevArticlesBtn" class="btn-sm btn-outline" disabled onclick="changeArticlePage(-1)">上一页</button>
                            <span id="articlePageInfo" style="font-size:0.875rem;color:var(--text-muted)"></span>
                            <button id="nextArticlesBtn" class="btn-sm btn-outline" disabled onclick="changeArticlePage(1)">下一页</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 排行榜 Tab -->
            <div id="tab-leaderboards" class="tab-content" style="display:none">
                <div class="section">
                    <h2 class="section-title">🏆 排行榜</h2>
                    
                    <!-- 排行榜网格布局 -->
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:24px;margin-top:24px">
                        
                        <!-- 文章数量排行榜 -->
                        <div class="card">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                                <h3 style="font-size:1.125rem;font-weight:600;color:var(--text)">📝 文章数量榜</h3>
                            </div>
                            <div id="articlesLeaderboard" style="display:flex;flex-direction:column;gap:12px">
                                <div style="text-align:center;padding:40px;color:var(--text-muted)">加载中...</div>
                            </div>
                        </div>

                        <!-- Token 消耗排行榜 -->
                        <div class="card">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                                <h3 style="font-size:1.125rem;font-weight:600;color:var(--text)">⚡ Token 消耗榜</h3>
                            </div>
                            <div id="tokensLeaderboard" style="display:flex;flex-direction:column;gap:12px">
                                <div style="text-align:center;padding:40px;color:var(--text-muted)">加载中...</div>
                            </div>
                        </div>

                        <!-- 充值金额排行榜 -->
                        <div class="card">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                                <h3 style="font-size:1.125rem;font-weight:600;color:var(--text)">💎 充值金额榜</h3>
                            </div>
                            <div id="rechargeLeaderboard" style="display:flex;flex-direction:column;gap:12px">
                                <div style="text-align:center;padding:40px;color:var(--text-muted)">加载中...</div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            <!-- 用户反馈 Tab -->
            <div id="tab-feedback" class="tab-content" style="display:none">
                <div class="section">
                    <h2 class="section-title">💬 用户反馈（工单系统）</h2>
                    <div class="toolbar">
                        <!-- 工单状态筛选 -->
                        <select id="ticketStatusFilter" class="form-select" onchange="loadAdminTickets()" style="max-width:150px">
                            <option value="all">全部状态</option>
                            <option value="open">待处理</option>
                            <option value="replied">已回复</option>
                            <option value="closed">已关闭</option>
                        </select>
                        <button onclick="loadAdminTickets()" class="btn-sm btn-outline">🔄 刷新</button>
                    </div>
                    <div id="adminTicketsList" class="card" style="margin-top:16px">
                        <div style="text-align:center;padding:40px;color:var(--text-muted)">加载中...</div>
                    </div>
                </div>
            </div>

            <!-- 管理员工单详情弹窗 -->
            <div class="modal-overlay" id="adminTicketDetailModal" onclick="if(event.target === this) closeAdminTicketDetailModal()">
                <div class="modal" style="max-width: 900px; max-height: 85vh;">
                    <div class="modal-header">
                        <div class="modal-title">工单详情</div>
                        <div class="close-btn" onclick="closeAdminTicketDetailModal()">×</div>
                    </div>
                    <div class="modal-body" style="max-height: calc(85vh - 120px); overflow-y: auto;">
                        <div id="adminTicketDetailContent">
                            <div style="text-align:center;padding:40px;color:var(--text-muted)">加载中...</div>
                        </div>
                        <div style="margin-top: 24px; padding-top: 24px; border-top: 2px solid var(--border);">
                            <label style="display: block; margin-bottom: 12px; font-weight: 600; color: var(--text); font-size: 15px;">管理员回复</label>
                            <textarea id="adminTicketReplyMessage" placeholder="输入您的回复..." rows="5" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; resize: vertical; font-family: inherit;"></textarea>
                            <div style="margin-top: 16px; display: flex; gap: 12px; justify-content: flex-end;">
                                <select id="adminTicketStatusSelect" style="padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px;">
                                    <option value="replied">标记为已回复</option>
                                    <option value="closed">标记为已关闭</option>
                                </select>
                                <button class="btn btn-primary" onclick="submitAdminTicketReply()">发送回复</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Orders Tab -->
            <div id="tab-orders" class="tab-content" style="display:none">
                <div class="section">
                    <h2 class="section-title">💰 支付记录</h2>
                    <div class="toolbar">
                        <!-- 搜索框：支持按订单号或用户邮箱搜索 -->
                        <input id="orderKeyword" type="text" class="form-input" placeholder="搜索订单号或用户邮箱..." style="flex:1;max-width:280px" oninput="fetchOrders(true)">
                        <select id="orderStatusFilter" class="form-select" onchange="fetchOrders(true)">
                            <option value="">全部状态</option>
                            <option value="pending">待支付</option>
                            <option value="paid">已支付</option>
                            <option value="cancelled">已取消</option>
                        </select>
                        <button onclick="fetchOrders(true)" class="btn-sm btn-outline">刷新</button>
                    </div>
                    <div class="card">
                        <div class="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>订单号</th>
                                        <th>用户</th>
                                        <th>金额</th>
                                        <th>额度</th>
                                        <th>状态</th>
                                        <th>支付渠道</th>
                                        <th>时间</th>
                                    </tr>
                                </thead>
                                <tbody id="ordersTable"></tbody>
                            </table>
                        </div>
                        <div style="padding:12px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border)">
                            <button id="prevOrdersBtn" class="btn-sm btn-outline" disabled onclick="changeOrderPage(-1)">上一页</button>
                            <span id="orderPageInfo" style="font-size:0.875rem;color:var(--text-muted)"></span>
                            <button id="nextOrdersBtn" class="btn-sm btn-outline" disabled onclick="changeOrderPage(1)">下一页</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Settings Tab -->
            <div id="tab-settings" class="tab-content" style="display:none">
                <div class="section">
                    <h2 class="section-title">⚙️ 系统设置</h2>
                    <div class="card" style="padding: 24px; max-width: 600px;">
                        <h3 style="margin-bottom: 12px; font-size: 1.1rem;">📧 支付邮件配置</h3>
                        <div style="background: linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(167,139,250,0.1) 100%); padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; border-left: 3px solid var(--accent-secondary);">
                            <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">
                                <strong>💡 提示：</strong>本系统使用 <strong>Resend</strong> 邮件服务，无需配置 SMTP。<br>
                                用户支付成功后会给用户发成功通知；如配置通知邮箱，也会同时给管理员发到账提醒。
                            </p>
                        </div>
                        
                        <form id="emailConfigForm" onsubmit="saveEmailConfig(event)">
                            <div class="form-group">
                                <label class="form-label">发件人邮箱 (Sender Email)</label>
                                <input type="email" id="email_sender" class="form-input" style="width:100%" placeholder="onboarding@resend.dev">
                                <p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">
                                    推荐使用 onboarding@resend.dev（测试）或配置自己的域名邮箱
                                </p>
                            </div>
                            <div class="form-group">
                                <label class="form-label">发件人名称 (Sender Name)</label>
                                <input type="text" id="email_sender_name" class="form-input" style="width:100%" placeholder="Memoraid" value="Memoraid">
                                <p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">邮件中显示的发件人名称</p>
                            </div>
                            <div class="form-group">
                                <label class="form-label">管理员通知邮箱 (Notification Email)</label>
                                <input type="email" id="email_recipient" class="form-input" style="width:100%" placeholder="admin@yourdomain.com">
                                <p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">用户充值成功后，会额外发送一封到账通知到这个邮箱</p>
                            </div>

                            <div style="margin-top: 24px;">
                                <button type="submit" class="btn-sm btn-success">保存配置</button>
                                <button type="button" class="btn-sm btn-outline" onclick="testEmailConfig()" style="margin-left: 12px;">发送测试邮件</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </main>
    </div> <!-- End mainLayout -->

    <!-- Login Modal -->
    <div id="loginModal" class="modal-overlay" style="display:none">
        <div class="modal">
            <div class="modal-title">管理员登录</div>
            <form id="loginForm">
                <div class="form-group">
                    <label class="form-label">用户名</label>
                    <input type="text" id="username" class="modal-input" placeholder="admin" required>
                </div>
                <div class="form-group">
                    <label class="form-label">密码</label>
                    <input type="password" id="password" class="modal-input" placeholder="••••••" required>
                </div>
                <button type="submit" class="btn-primary">登录</button>
                <div id="loginError" class="modal-error"></div>
            </form>
        </div>
    </div>

    <!-- Change Password Modal -->
    <div id="changePwdModal" class="modal-overlay" style="display:none">
        <div class="modal">
            <div class="modal-title">首次登录请修改密码</div>
            <form id="changePwdForm">
                <div class="form-group">
                    <label class="form-label">旧密码 (默认 123456)</label>
                    <input type="password" id="oldPwd" class="modal-input" required>
                </div>
                <div class="form-group">
                    <label class="form-label">新密码</label>
                    <input type="password" id="newPwd" class="modal-input" minlength="6" required>
                </div>
                <div class="form-group">
                    <label class="form-label">确认新密码</label>
                    <input type="password" id="confirmPwd" class="modal-input" minlength="6" required>
                </div>
                <button type="submit" class="btn-primary">修改并继续</button>
                <div id="changePwdError" class="modal-error"></div>
            </form>
        </div>
    </div>

    <script>
        console.log('Admin script loaded');
        
        // Simple logger wrapper
        function log(msg) {
            console.log('[Admin]', msg);
        }

        window.onerror = function(message, source, lineno, colno, error) {
            log('ERROR: ' + message);
            const errorDiv = document.getElementById('globalError');
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.innerHTML = '<strong>系统错误:</strong><br>' + message;
                const loadingEl = document.getElementById('loading');
                if (loadingEl) loadingEl.style.display = 'none';
            }
        };

        window.addEventListener('unhandledrejection', function(event) {
            log('PROMISE ERROR: ' + event.reason);
        });

        const API_BASE = '';
        // Pagination state for Articles
        let articlesOffset = 0;
        const articlesLimit = 20;
        let articlesTotal = 0;
        let isFetchingArticles = false;

        // Pagination state for Users
        let usersOffset = 0;
        const usersLimit = 20; // 每页显示20条用户数据
        let usersTotal = 0;
        let isFetchingUsers = false;
        let userSort = 'last_active';  // 默认按最后活跃时间排序
        let userSortOrder = 'desc';
        let userPaidOnly = false; // 是否仅看付费用户
        let userNewOnly = false; // 是否仅看新用户（当日注册）
        let userSearchKeyword = ''; // 搜索关键词
        
        async function fetchStats() {
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const headers = { 'Authorization': 'Bearer ' + token };
                const response = await fetch('/api/admin/system-stats', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                if (response.status === 401 || response.status === 403) {
                    localStorage.removeItem('memoraid_admin_token');
                    showLogin();
                    return;
                }
                
                if (!response.ok) throw new Error(await response.text());
                
                const data = await response.json();
                renderDashboard(data);
                document.getElementById('logoutBtn').style.display = 'block';
            } catch (e) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('globalError').style.display = 'block';
                document.getElementById('globalError').textContent = '加载失败: ' + e.message;
            }
        }

        async function fetchUsers(reset = false) {
            if (isFetchingUsers) return;
            isFetchingUsers = true;

            if (reset) usersOffset = 0;

            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const params = new URLSearchParams({
                    limit: usersLimit.toString(),
                    offset: usersOffset.toString(),
                    sort: userSort,
                    order: userSortOrder,
                    paid_only: userPaidOnly ? '1' : '0',
                    new_only: userNewOnly ? '1' : '0', // 添加新用户筛选参数
                    keyword: userSearchKeyword // 添加搜索关键词参数
                });

                const response = await fetch('/api/admin/users?' + params.toString(), {
                    headers: { 'Authorization': 'Bearer ' + token }
                });

                if (!response.ok) throw new Error('Failed to fetch users');

                const data = await response.json();
                usersTotal = data.total;
                document.getElementById('userCountBadge').textContent = usersTotal;
                renderUsers(data.users);
                updateUserPagination();
            } catch (e) {
                console.error(e);
            } finally {
                isFetchingUsers = false;
            }
        }

        async function fetchArticles(reset = false) {
            if (isFetchingArticles) return;
            isFetchingArticles = true;
            
            if (reset) {
                articlesOffset = 0;
                // document.getElementById('articlesTable').innerHTML = ''; // Don't clear immediately to avoid flash
            }

            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const q = document.getElementById('searchInput').value;
                const platform = document.getElementById('platformFilter').value;
                
                const params = new URLSearchParams({
                    q,
                    platform,
                    limit: articlesLimit.toString(),
                    offset: articlesOffset.toString()
                });

                const response = await fetch('/api/admin/articles?' + params.toString(), {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                if (!response.ok) throw new Error('Failed to fetch articles');
                
                const data = await response.json();
                articlesTotal = data.total;
                renderArticles(data.articles);
                updateArticlePagination();
                
                document.getElementById('resultCount').textContent = \`共 \${data.total} 条记录\`;

            } catch (e) {
                console.error(e);
            } finally {
                isFetchingArticles = false;
            }
        }

        function getPlatformIcon(name, defaultIcon) {
            const style = 'width:24px;height:24px;vertical-align:middle;display:inline-block;border-radius:4px;';
            const largeStyle = 'width:32px;height:32px;vertical-align:middle;display:inline-block;border-radius:6px;';
            
            // Simple Icons CDN for known platforms
            const weixin = \`<img src="https://cdn.simpleicons.org/wechat/07C160" style="\${largeStyle}" alt="WeChat">\`;
            const zhihu = \`<img src="https://cdn.simpleicons.org/zhihu/0084FF" style="\${largeStyle}" alt="Zhihu">\`;
            
            // Fallback SVG for Toutiao (Red background with '头条' text)
            const toutiao = \`<svg viewBox="0 0 100 100" style="\${largeStyle}"><rect width="100" height="100" rx="20" fill="#ED4040"/><text x="50" y="70" font-size="50" fill="white" text-anchor="middle" font-family="sans-serif" font-weight="bold">头条</text></svg>\`;
            
            // Fallback SVG for Xiaohongshu (Red background with '小红书' text)
            const xiaohongshu = \`<svg viewBox="0 0 100 100" style="\${largeStyle}"><rect width="100" height="100" rx="20" fill="#FF2442"/><text x="50" y="70" font-size="35" fill="white" text-anchor="middle" font-family="sans-serif" font-weight="bold">小红书</text></svg>\`;
            
            if (name.includes('weixin')) return weixin;
            if (name.includes('zhihu')) return zhihu;
            if (name.includes('toutiao')) return toutiao;
            if (name.includes('xiaohongshu')) return xiaohongshu;
            
            return defaultIcon;
        }

        function renderDashboard(data) {
            log('renderDashboard called');
            document.getElementById('loading').style.display = 'none';
            document.getElementById('mainLayout').style.display = 'flex';
            
            // Overview
            document.getElementById('totalUsers').textContent = data.overview?.users || '-';
            document.getElementById('totalArticles').textContent = data.overview?.articles || '-';
            document.getElementById('totalAccounts').textContent = data.overview?.accounts || '-';
            document.getElementById('activeUsersToday').textContent = data.overview?.activeUsersToday || '0';
            document.getElementById('newUsersToday').textContent = data.overview?.newUsersToday || '0';
            document.getElementById('newArticlesToday').textContent = data.overview?.newArticlesToday || '0';
            document.getElementById('todayRechargeAmount').textContent = (data.overview?.todayRechargeAmount || 0).toFixed(2);
            document.getElementById('todayRechargeCount').textContent = data.overview?.todayRechargeCount || '0';
            document.getElementById('totalRechargeAmount').textContent =  (data.overview?.totalRechargeAmount || 0).toFixed(2);
            document.getElementById('pendingOrderCount').textContent = data.overview?.pendingOrderCount || '0';
            
            // Platforms
            const platformFilter = document.getElementById('platformFilter');
            const currentPlatform = platformFilter.value;
            platformFilter.innerHTML = '<option value="">所有平台</option>';
            
            const platformHtml = data.platforms.map(p => {
                platformFilter.innerHTML += \`<option value="\${p.name}">\${p.display_name}</option>\`;
                const icon = getPlatformIcon(p.name, p.icon || '📄');
                return \`
                <div class="platform-item" onclick="filterByPlatform('\${p.name}')">
                    <div class="platform-icon">\${icon}</div>
                    <div class="platform-count">\${p.count}</div>
                    <div class="platform-name">\${p.display_name}</div>
                </div>
                \`;
            }).join('');
            document.getElementById('platformStats').innerHTML = platformHtml || '<div style="grid-column:1/-1;text-align:center;color:#666">暂无数据</div>';
            platformFilter.value = currentPlatform; // Restore value
            
            // document.getElementById('adminInfo').textContent = 'Admin Mode';
        }

        function renderUsers(users) {
            const html = users.map(u => {
                const limit = (u.provider === 'anonymous') ? 5 : 20;
                // 判断是否为付费用户（有已支付的充值记录）
                const isPaid = u.paid_count > 0;
                const paidBadge = isPaid ? '<span style="background:#f97316;color:#fff;font-size:0.65rem;padding:1px 5px;border-radius:4px;margin-left:6px;vertical-align:middle">付费</span>' : '';
                // 判断是否为当日新增用户
                const isNewToday = u.is_new_today === 1;
                const newBadge = isNewToday ? '<span style="background:#10b981;color:#fff;font-size:0.65rem;padding:1px 5px;border-radius:4px;margin-left:6px;vertical-align:middle">新</span>' : '';
                // 格式化token数量（大于1000时显示为K）
                const formatTokens = (tokens) => {
                    if (!tokens || tokens === 0) return '0';
                    if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
                    if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
                    return tokens.toString();
                };
                return \`
                <tr style="cursor:pointer">
                    <td onclick="goToUserArticles('\${u.email}')" title="点击查看此用户的所有文章">
                        <div class="user-cell">
                            <div class="avatar" style="\${isPaid ? 'background:linear-gradient(135deg,#f97316,#fbbf24)' : ''}">\${u.email[0].toUpperCase()}</div>
                            <div class="user-email" style="color:var(--accent-secondary)">\${u.email}\${paidBadge}\${newBadge}</div>
                        </div>
                    </td>
                    <td>\${u.provider}</td>
                    <td title="已生成 \${u.total_articles || 0} 篇文章"><span class="status-pill \${(u.ai_usage >= limit) ? 'error' : 'success'}">\${u.ai_usage || 0}/\${limit}</span></td>
                    <td><span class="status-pill success">\${u.paid_quota_remaining || 0}</span></td>
                    <td><span class="status-pill \${u.articles_3d > 0 ? 'success' : ''}">\${u.articles_3d || 0}</span></td>
                    <td><span class="status-pill \${u.articles_7d > 0 ? 'success' : ''}">\${u.articles_7d || 0}</span></td>
                    <td><span class="status-pill \${u.total_tokens > 0 ? 'info' : ''}" title="\${u.total_tokens || 0} tokens">\${formatTokens(u.total_tokens)}</span></td>
                    <td>\${new Date(u.created_at * 1000).toLocaleDateString()}</td>
                    <td>\${u.last_active ? new Date(u.last_active * 1000).toLocaleString() : '-'}</td>
                </tr>
            \`}).join('');
            document.getElementById('recentUsers').innerHTML = html || '<tr><td colspan="9" style="text-align:center">暂无数据</td></tr>';
        }

        function renderArticles(articles) {
            const html = articles.map(a => {
                const icon = getPlatformIcon(a.platform_name || '', a.platform_icon || '');
                // 显示 token 消耗，若无数据则显示 -
                const tokenText = a.totalTokens != null
                    ? \`<span title="输入:\${a.promptTokens} 输出:\${a.completionTokens}" style="cursor:default">\${a.totalTokens.toLocaleString()}</span>\`
                    : '<span style="color:var(--text-muted)">-</span>';
                return \`
                <tr>
                    <td><div class="truncate-title" title="\${a.title}">\${a.title || '无标题'}</div></td>
                    <td>\${icon} \${a.platform_name || ''}</td>
                    <td><span class="status-pill \${a.status}">\${a.status === 'generated' ? '已生成' : '已发布'}</span></td>
                    <td onclick="filterByUser('\${a.user_email}')" style="cursor:pointer;color:var(--accent-secondary)" title="点击筛选此用户的文章">\${a.user_email}</td>
                    <!-- 显示该用户的第几篇文章，用徽章样式展示 -->
                    <td><span style="background:var(--bg-muted);color:var(--text-muted);padding:2px 8px;border-radius:12px;font-size:0.8rem;font-weight:500">第 \${a.user_article_index} 篇</span></td>
                    <!-- Token 消耗，鼠标悬停显示输入/输出明细 -->
                    <td>\${tokenText}</td>
                    <td>\${new Date(a.publish_time * 1000).toLocaleString()}</td>
                </tr>
            \`}).join('');
            
            // colspan 改为 6，因为新增了"第几篇"列
            document.getElementById('articlesTable').innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#9ca3af">暂无数据</td></tr>';
        }

        // Pagination Controls
        function changeUserPage(delta) {
            usersOffset += delta * usersLimit;
            if (usersOffset < 0) usersOffset = 0;
            fetchUsers();
        }

        function updateUserPagination() {
            const currentPage = Math.floor(usersOffset / usersLimit) + 1;
            const totalPages = Math.ceil(usersTotal / usersLimit) || 1;
            
            document.getElementById('userPageInfo').textContent = \`第 \${currentPage} / \${totalPages} 页\`;
            document.getElementById('prevUsersBtn').disabled = usersOffset <= 0;
            document.getElementById('nextUsersBtn').disabled = (usersOffset + usersLimit) >= usersTotal;
        }

        function changeArticlePage(delta) {
            articlesOffset += delta * articlesLimit;
            if (articlesOffset < 0) articlesOffset = 0;
            fetchArticles();
        }

        function updateArticlePagination() {
            const currentPage = Math.floor(articlesOffset / articlesLimit) + 1;
            const totalPages = Math.ceil(articlesTotal / articlesLimit) || 1;
            
            document.getElementById('articlePageInfo').textContent = \`第 \${currentPage} / \${totalPages} 页\`;
            document.getElementById('prevArticlesBtn').disabled = articlesOffset <= 0;
            document.getElementById('nextArticlesBtn').disabled = (articlesOffset + articlesLimit) >= articlesTotal;
        }

        // 切换付费用户筛选
        function togglePaidFilter() {
            userPaidOnly = !userPaidOnly;
            const btn = document.getElementById('paidFilterBtn');
            if (userPaidOnly) {
                btn.style.background = 'var(--accent)';
                btn.style.color = '#fff';
                btn.textContent = '💰 仅看付费用户 ✓';
            } else {
                btn.style.background = '';
                btn.style.color = '';
                btn.textContent = '💰 仅看付费用户';
            }
            fetchUsers(true);
        }

        // 切换新用户筛选（当日注册）
        function toggleNewFilter() {
            userNewOnly = !userNewOnly;
            const btn = document.getElementById('newFilterBtn');
            if (userNewOnly) {
                btn.style.background = 'var(--accent)';
                btn.style.color = '#fff';
                btn.textContent = '🆕 仅看新用户 ✓';
            } else {
                btn.style.background = '';
                btn.style.color = '';
                btn.textContent = '🆕 仅看新用户';
            }
            fetchUsers(true);
        }

        // 处理用户搜索（支持实时搜索）
        let searchTimeout = null;
        function handleUserSearch(event) {
            // 清除之前的定时器
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            
            // 获取搜索关键词
            const keyword = event.target.value.trim();
            
            // 延迟300ms执行搜索，避免频繁请求
            searchTimeout = setTimeout(() => {
                userSearchKeyword = keyword;
                fetchUsers(true); // 重置到第一页并搜索
            }, 300);
        }

        function toggleSort(field) {
            if (userSort === field) {
                // Toggle order: desc -> asc -> desc
                userSortOrder = userSortOrder === 'desc' ? 'asc' : 'desc';
            } else {
                // New field, default to desc
                userSort = field;
                userSortOrder = 'desc';
            }
            
            // Update UI
            document.querySelectorAll('.sortable').forEach(el => {
                el.classList.remove('active', 'asc');
            });
            
            const activeEl = document.getElementById('sort-' + field);
            activeEl.classList.add('active');
            if (userSortOrder === 'asc') {
                activeEl.classList.add('asc');
            }
            
            fetchUsers(true);
        }

        // Actions
        function filterByPlatform(name) {
            document.getElementById('platformFilter').value = name;
            fetchArticles(true);
            document.getElementById('searchInput').scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Highlight active platform card
            document.querySelectorAll('.platform-item').forEach(el => el.classList.remove('active'));
        }

        // ========== 仪表盘趋势图表 ==========
        let currentChartRange = 30; // 默认30天

        // 切换时间范围并刷新图表
        function switchChartRange(days) {
            currentChartRange = days;
            // 更新按钮样式
            [7, 30, 90].forEach(d => {
                const btn = document.getElementById('rangeBtn' + d);
                if (d === days) {
                    btn.style.background = 'var(--accent)';
                    btn.style.color = '#fff';
                } else {
                    btn.style.background = '';
                    btn.style.color = '';
                }
            });
            loadDashboardCharts();
        }

        // 加载仪表盘图表数据（4个图表：活跃用户、生成文章、新增用户、充值金额）
        async function loadDashboardCharts() {
            const token = localStorage.getItem('memoraid_admin_token');
            const days = currentChartRange;
            try {
                // 并行请求四个趋势数据
                const [activeRes, articlesRes, newUsersRes, rechargeRes] = await Promise.all([
                    fetch('/api/admin/trends?type=activeUsers&days=' + days, { headers: { 'Authorization': 'Bearer ' + token } }),
                    fetch('/api/admin/trends?type=newArticles&days=' + days, { headers: { 'Authorization': 'Bearer ' + token } }),
                    fetch('/api/admin/trends?type=newUsers&days=' + days, { headers: { 'Authorization': 'Bearer ' + token } }),
                    fetch('/api/admin/trends?type=rechargeAmount&days=' + days, { headers: { 'Authorization': 'Bearer ' + token } })
                ]);
                const activeData = await activeRes.json();
                const articlesData = await articlesRes.json();
                const newUsersData = await newUsersRes.json();
                const rechargeData = await rechargeRes.json();
                
                // 绘制四个图表，使用不同颜色
                drawDashChart('dashActiveChart', activeData.labels, activeData.values, '#10b981'); // 绿色 - 活跃用户
                drawDashChart('dashArticlesChart', articlesData.labels, articlesData.values, '#fbbf24'); // 黄色 - 生成文章
                drawDashChart('dashNewUsersChart', newUsersData.labels, newUsersData.values, '#3b82f6'); // 蓝色 - 新增用户
                drawDashChart('dashRechargeChart', rechargeData.labels, rechargeData.values, '#8b5cf6'); // 紫色 - 充值金额
            } catch (e) {
                console.error('仪表盘图表加载失败:', e);
            }
        }

        // 绘制仪表盘小图表（复用折线图逻辑，适配小尺寸）
        function drawDashChart(canvasId, labels, values, color) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            const W = rect.width, H = rect.height;
            ctx.clearRect(0, 0, W, H);

            const padL = 40, padR = 10, padT = 10, padB = 30;
            const chartW = W - padL - padR;
            const chartH = H - padT - padB;
            const maxVal = Math.max(...values, 1);
            const stepX = chartW / (labels.length - 1 || 1);

            // Y轴网格线和标签
            ctx.strokeStyle = '#e5e7eb';
            ctx.lineWidth = 0.5;
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'right';
            const ySteps = 4;
            for (let i = 0; i <= ySteps; i++) {
                const y = padT + chartH - (i / ySteps) * chartH;
                ctx.fillText(Math.round(maxVal * i / ySteps).toString(), padL - 6, y + 3);
                ctx.beginPath();
                ctx.moveTo(padL, y);
                ctx.lineTo(W - padR, y);
                ctx.stroke();
            }

            // 渐变填充
            const gradient = ctx.createLinearGradient(0, padT, 0, padT + chartH);
            gradient.addColorStop(0, color + '35');
            gradient.addColorStop(1, color + '05');
            ctx.beginPath();
            ctx.moveTo(padL, padT + chartH);
            for (let i = 0; i < values.length; i++) {
                ctx.lineTo(padL + i * stepX, padT + chartH - (values[i] / maxVal) * chartH);
            }
            ctx.lineTo(padL + (values.length - 1) * stepX, padT + chartH);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();

            // 折线
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            for (let i = 0; i < values.length; i++) {
                const x = padL + i * stepX;
                const y = padT + chartH - (values[i] / maxVal) * chartH;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // 数据点（数据量大时只画有值的点）
            for (let i = 0; i < values.length; i++) {
                if (values[i] > 0 || values.length <= 30) {
                    const x = padL + i * stepX;
                    const y = padT + chartH - (values[i] / maxVal) * chartH;
                    ctx.beginPath();
                    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                    ctx.fillStyle = values[i] > 0 ? color : '#cbd5e1';
                    ctx.fill();
                }
            }

            // X轴日期标签（自适应间隔）
            ctx.fillStyle = '#94a3b8';
            ctx.font = '9px Inter, sans-serif';
            ctx.textAlign = 'center';
            const maxLabels = 8;
            const interval = Math.ceil(labels.length / maxLabels);
            for (let i = 0; i < labels.length; i++) {
                if (i % interval === 0 || i === labels.length - 1) {
                    ctx.fillText(labels[i], padL + i * stepX, H - 6);
                }
            }

            // 右上角显示总计（放在图表区域外上方，避免遮挡折线）
            const sum = values.reduce((a, b) => a + b, 0);
            ctx.fillStyle = '#64748b';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('合计: ' + sum, W - padR, 10);
        }

        // ========== 平台文章数量趋势图 ==========
        let currentPlatformChartRange = 30; // 默认30天

        // 平台颜色映射（为每个平台分配不同颜色）
        const platformColors = {
            'weixin': '#07C160',      // 微信绿
            'toutiao': '#ED4040',     // 头条红
            'zhihu': '#0084FF',       // 知乎蓝
            'xiaohongshu': '#FF6B9D', // 小红书粉红（改为更亮的粉色，与头条红区分）
            'default': '#6b7280'      // 默认灰色
        };

        // 切换平台图表时间范围
        function switchPlatformChartRange(days) {
            currentPlatformChartRange = days;
            // 更新按钮样式
            [7, 30, 90].forEach(d => {
                const btn = document.getElementById('platformRangeBtn' + d);
                if (d === days) {
                    btn.style.background = 'var(--accent)';
                    btn.style.color = '#fff';
                } else {
                    btn.style.background = '';
                    btn.style.color = '';
                }
            });
            loadPlatformTrendsChart();
        }

        // 加载平台趋势图数据
        async function loadPlatformTrendsChart() {
            const token = localStorage.getItem('memoraid_admin_token');
            const days = currentPlatformChartRange;
            try {
                const res = await fetch('/api/admin/platform-trends?days=' + days, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) throw new Error('加载失败');
                const data = await res.json();
                console.log('平台趋势数据:', data); // 调试日志
                
                // 如果没有数据，显示提示信息
                if (!data.platforms || data.platforms.length === 0) {
                    const canvas = document.getElementById('platformTrendsChart');
                    if (canvas) {
                        const ctx = canvas.getContext('2d');
                        const rect = canvas.parentElement.getBoundingClientRect();
                        canvas.width = rect.width;
                        canvas.height = rect.height;
                        ctx.clearRect(0, 0, rect.width, rect.height);
                        ctx.fillStyle = '#94a3b8';
                        ctx.font = '14px Inter, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText('暂无平台数据', rect.width / 2, rect.height / 2);
                    }
                    document.getElementById('platformLegend').innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:0.875rem">暂无数据</div>';
                    return;
                }
                
                drawPlatformTrendsChart(data.labels, data.platforms);
            } catch (e) {
                console.error('平台趋势图加载失败:', e);
                // 显示错误信息
                const canvas = document.getElementById('platformTrendsChart');
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    const rect = canvas.parentElement.getBoundingClientRect();
                    canvas.width = rect.width;
                    canvas.height = rect.height;
                    ctx.clearRect(0, 0, rect.width, rect.height);
                    ctx.fillStyle = '#ef4444';
                    ctx.font = '14px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('加载失败: ' + e.message, rect.width / 2, rect.height / 2);
                }
            }
        }

        // 绘制平台趋势图（多条折线）
        function drawPlatformTrendsChart(labels, platforms) {
            const canvas = document.getElementById('platformTrendsChart');
            if (!canvas) return;
            
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            const W = rect.width, H = rect.height;
            ctx.clearRect(0, 0, W, H);

            const padL = 50, padR = 20, padT = 20, padB = 40;
            const chartW = W - padL - padR;
            const chartH = H - padT - padB;
            
            // 计算所有平台的最大值
            let maxVal = 1;
            platforms.forEach(p => {
                const pMax = Math.max(...p.values);
                if (pMax > maxVal) maxVal = pMax;
            });
            
            const stepX = chartW / (labels.length - 1 || 1);

            // Y轴网格线和标签
            ctx.strokeStyle = '#e5e7eb';
            ctx.lineWidth = 0.5;
            ctx.fillStyle = '#94a3b8';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'right';
            const ySteps = 5;
            for (let i = 0; i <= ySteps; i++) {
                const y = padT + chartH - (i / ySteps) * chartH;
                ctx.fillText(Math.round(maxVal * i / ySteps).toString(), padL - 8, y + 4);
                ctx.beginPath();
                ctx.moveTo(padL, y);
                ctx.lineTo(W - padR, y);
                ctx.stroke();
            }

            // 存储数据点位置，用于鼠标悬浮检测
            const dataPoints = [];

            // 绘制每个平台的折线
            platforms.forEach(platform => {
                const color = platformColors[platform.name] || platformColors.default;
                
                // 折线
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 2.5;
                ctx.lineJoin = 'round';
                
                for (let i = 0; i < platform.values.length; i++) {
                    const x = padL + i * stepX;
                    const y = padT + chartH - (platform.values[i] / maxVal) * chartH;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
                
                // 数据点
                for (let i = 0; i < platform.values.length; i++) {
                    if (platform.values[i] > 0) {
                        const x = padL + i * stepX;
                        const y = padT + chartH - (platform.values[i] / maxVal) * chartH;
                        ctx.beginPath();
                        ctx.arc(x, y, 3, 0, Math.PI * 2);
                        ctx.fillStyle = color;
                        ctx.fill();
                        ctx.strokeStyle = '#fff';
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                        
                        // 保存数据点信息用于tooltip
                        dataPoints.push({
                            x, y,
                            date: labels[i],
                            platform: platform.displayName,
                            value: platform.values[i],
                            color
                        });
                    }
                }
            });

            // X轴日期标签
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            const maxLabels = 10;
            const interval = Math.ceil(labels.length / maxLabels);
            for (let i = 0; i < labels.length; i++) {
                if (i % interval === 0 || i === labels.length - 1) {
                    ctx.fillText(labels[i], padL + i * stepX, H - 10);
                }
            }

            // 更新图例
            updatePlatformLegend(platforms);
            
            // 添加鼠标移动事件监听，显示tooltip
            const tooltip = document.getElementById('platformTooltip');
            if (!tooltip) return;
            
            // 移除旧的事件监听器（如果存在）
            const oldHandler = canvas._mousemoveHandler;
            if (oldHandler) {
                canvas.removeEventListener('mousemove', oldHandler);
                canvas.removeEventListener('mouseleave', canvas._mouseleaveHandler);
            }
            
            // 记录当前显示的日期索引，避免重复更新
            let currentDateIndex = -1;
            let tooltipTimeout = null;
            
            // 鼠标移动事件
            const mousemoveHandler = (e) => {
                const canvasRect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - canvasRect.left;
                const mouseY = e.clientY - canvasRect.top;
                
                // 判断鼠标在哪个日期范围内（按X轴位置）
                let dateIndex = -1;
                let minDistX = stepX / 2; // 半个步长作为阈值
                
                for (let i = 0; i < labels.length; i++) {
                    const x = padL + i * stepX;
                    const distX = Math.abs(mouseX - x);
                    if (distX < minDistX) {
                        minDistX = distX;
                        dateIndex = i;
                    }
                }
                
                // 检查是否在图表区域内
                const inChartArea = mouseX >= padL && mouseX <= W - padR && mouseY >= padT && mouseY <= padT + chartH;
                
                // 如果日期没有改变，不更新tooltip（避免闪烁）
                if (dateIndex === currentDateIndex && inChartArea) {
                    return;
                }
                
                // 清除之前的延迟
                if (tooltipTimeout) {
                    clearTimeout(tooltipTimeout);
                    tooltipTimeout = null;
                }
                
                // 如果找到了日期且在图表区域内，显示该日期所有平台的数据
                if (dateIndex >= 0 && inChartArea) {
                    currentDateIndex = dateIndex;
                    const date = labels[dateIndex];
                    
                    // 收集该日期所有平台的数据（只显示有数据的平台）
                    const platformsData = platforms
                        .filter(p => p.values[dateIndex] > 0)
                        .map(p => ({
                            name: p.displayName,
                            value: p.values[dateIndex],
                            color: platformColors[p.name] || platformColors.default
                        }))
                        .sort((a, b) => b.value - a.value); // 按数量降序排列
                    
                    if (platformsData.length > 0) {
                        // 更新tooltip内容
                        tooltip.innerHTML = \`
                            <div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:4px">\${date}</div>
                            \${platformsData.map(p => \`
                                <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
                                    <div style="width:8px;height:8px;border-radius:50%;background:\${p.color};flex-shrink:0"></div>
                                    <span style="flex:1">\${p.name}</span>
                                    <strong>\${p.value}篇</strong>
                                </div>
                            \`).join('')}
                        \`;
                        
                        // 显示tooltip（带淡入效果）
                        tooltip.style.display = 'block';
                        // 使用requestAnimationFrame确保display生效后再设置opacity
                        requestAnimationFrame(() => {
                            tooltip.style.opacity = '1';
                        });
                        
                        // 计算tooltip位置
                        const tooltipX = padL + dateIndex * stepX + 15;
                        const tooltipY = mouseY - 10;
                        
                        tooltip.style.left = tooltipX + 'px';
                        tooltip.style.top = tooltipY + 'px';
                        
                        // 延迟检查边界，等待tooltip渲染完成
                        setTimeout(() => {
                            if (tooltipX + tooltip.offsetWidth > W) {
                                tooltip.style.left = (padL + dateIndex * stepX - tooltip.offsetWidth - 15) + 'px';
                            }
                            if (tooltipY < 0) {
                                tooltip.style.top = '10px';
                            }
                            if (tooltipY + tooltip.offsetHeight > H) {
                                tooltip.style.top = (H - tooltip.offsetHeight - 10) + 'px';
                            }
                        }, 0);
                    } else {
                        currentDateIndex = -1;
                        tooltip.style.opacity = '0';
                        tooltipTimeout = setTimeout(() => {
                            tooltip.style.display = 'none';
                        }, 150); // 等待淡出动画完成
                    }
                } else {
                    currentDateIndex = -1;
                    tooltip.style.opacity = '0';
                    tooltipTimeout = setTimeout(() => {
                        tooltip.style.display = 'none';
                    }, 150); // 等待淡出动画完成
                }
            };
            
            // 鼠标离开事件
            const mouseleaveHandler = () => {
                currentDateIndex = -1;
                tooltip.style.opacity = '0';
                if (tooltipTimeout) {
                    clearTimeout(tooltipTimeout);
                }
                tooltipTimeout = setTimeout(() => {
                    tooltip.style.display = 'none';
                }, 150); // 等待淡出动画完成
            };
            
            canvas.addEventListener('mousemove', mousemoveHandler);
            canvas.addEventListener('mouseleave', mouseleaveHandler);
            
            // 保存事件处理器引用，用于下次清理
            canvas._mousemoveHandler = mousemoveHandler;
            canvas._mouseleaveHandler = mouseleaveHandler;
        }

        // 更新平台图例
        function updatePlatformLegend(platforms) {
            const legendDiv = document.getElementById('platformLegend');
            if (!legendDiv) return;
            
            legendDiv.innerHTML = platforms.map(p => {
                const color = platformColors[p.name] || platformColors.default;
                const total = p.values.reduce((a, b) => a + b, 0);
                return \`
                    <div style="display:flex;align-items:center;gap:6px;font-size:0.85rem">
                        <div style="width:12px;height:12px;border-radius:2px;background:\${color}"></div>
                        <span style="color:var(--text-secondary)">\${p.displayName}</span>
                        <span style="color:var(--text-muted);font-size:0.8rem">(\${total}篇)</span>
                    </div>
                \`;
            }).join('');
        }

        // ========== 趋势图功能（模态框） ==========
        // 显示趋势图模态框，type: activeUsers/newUsers/newArticles/rechargeAmount
        async function showTrendChart(type, title) {
            const modal = document.getElementById('trendModal');
            document.getElementById('trendTitle').textContent = title + ' - 历史趋势';
            modal.style.display = 'flex';

            // 请求后端趋势数据
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const resp = await fetch('/api/admin/trends?type=' + type + '&days=30', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!resp.ok) throw new Error('请求失败');
                const data = await resp.json();
                drawTrendChart(data.labels, data.values, type);
                showTrendSummary(data.values, type);
            } catch (e) {
                console.error('趋势数据加载失败:', e);
            }
        }

        // 关闭趋势图模态框
        function closeTrendModal() {
            document.getElementById('trendModal').style.display = 'none';
        }

        // 点击模态框背景关闭
        document.getElementById('trendModal').addEventListener('click', function(e) {
            if (e.target === this) closeTrendModal();
        });

        // 用 Canvas 绘制折线图
        function drawTrendChart(labels, values, type) {
            const canvas = document.getElementById('trendCanvas');
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            const W = rect.width, H = rect.height;

            // 清空画布
            ctx.clearRect(0, 0, W, H);

            // 图表区域（留出边距给坐标轴标签）
            const padL = 50, padR = 20, padT = 20, padB = 40;
            const chartW = W - padL - padR;
            const chartH = H - padT - padB;

            const maxVal = Math.max(...values, 1); // 防止全0时除零
            const stepX = chartW / (labels.length - 1 || 1);

            // 根据类型选择颜色
            const colors = {
                activeUsers: '#10b981',
                newUsers: '#38bdf8',
                newArticles: '#fbbf24',
                rechargeAmount: '#f97316'
            };
            const color = colors[type] || '#10b981';

            // 绘制Y轴网格线和标签
            ctx.strokeStyle = '#e5e7eb';
            ctx.lineWidth = 0.5;
            ctx.fillStyle = '#94a3b8';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'right';
            const ySteps = 5;
            for (let i = 0; i <= ySteps; i++) {
                const y = padT + chartH - (i / ySteps) * chartH;
                const val = (maxVal * i / ySteps);
                // 充值金额显示两位小数，其他显示整数
                const label = type === 'rechargeAmount' ? '¥' + val.toFixed(0) : Math.round(val).toString();
                ctx.fillText(label, padL - 8, y + 4);
                ctx.beginPath();
                ctx.moveTo(padL, y);
                ctx.lineTo(W - padR, y);
                ctx.stroke();
            }

            // 绘制渐变填充区域
            const gradient = ctx.createLinearGradient(0, padT, 0, padT + chartH);
            gradient.addColorStop(0, color + '40'); // 带透明度
            gradient.addColorStop(1, color + '05');
            ctx.beginPath();
            ctx.moveTo(padL, padT + chartH);
            for (let i = 0; i < values.length; i++) {
                const x = padL + i * stepX;
                const y = padT + chartH - (values[i] / maxVal) * chartH;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(padL + (values.length - 1) * stepX, padT + chartH);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();

            // 绘制折线
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            for (let i = 0; i < values.length; i++) {
                const x = padL + i * stepX;
                const y = padT + chartH - (values[i] / maxVal) * chartH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // 绘制数据点
            for (let i = 0; i < values.length; i++) {
                const x = padL + i * stepX;
                const y = padT + chartH - (values[i] / maxVal) * chartH;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = values[i] > 0 ? color : '#cbd5e1';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            // 绘制X轴日期标签（每隔几天显示一个，避免拥挤）
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            const labelInterval = Math.ceil(labels.length / 10); // 最多显示10个标签
            for (let i = 0; i < labels.length; i++) {
                if (i % labelInterval === 0 || i === labels.length - 1) {
                    const x = padL + i * stepX;
                    ctx.fillText(labels[i], x, H - 8);
                }
            }
        }

        // 显示趋势汇总信息（总计、平均、最高）
        function showTrendSummary(values, type) {
            const sum = values.reduce((a, b) => a + b, 0);
            const avg = sum / values.length;
            const max = Math.max(...values);
            const isAmount = type === 'rechargeAmount';
            const fmt = v => isAmount ? '¥' + v.toFixed(2) : Math.round(v);

            document.getElementById('trendSummary').innerHTML =
                '<div><span style="color:var(--text-muted)">30天总计</span><br><strong>' + fmt(sum) + '</strong></div>' +
                '<div><span style="color:var(--text-muted)">日均</span><br><strong>' + fmt(avg) + '</strong></div>' +
                '<div><span style="color:var(--text-muted)">单日最高</span><br><strong>' + fmt(max) + '</strong></div>';
        }

        // 通用复制到剪贴板函数，复制成功后短暂显示"已复制"提示
        function copyText(text, el) {
            navigator.clipboard.writeText(text).then(() => {
                const orig = el.textContent;
                el.textContent = '已复制!';
                el.style.color = 'var(--accent-secondary)';
                setTimeout(() => {
                    el.textContent = orig;
                    el.style.color = '';
                }, 1200);
            }).catch(() => {});
        }

        function goToPendingOrders() {
            const filter = document.getElementById('orderStatusFilter');
            if (filter) filter.value = 'pending';
            switchTab('orders');
            fetchOrders(true);
        }

        function filterByUser(email) {
            document.getElementById('searchInput').value = email;
            fetchArticles(true);
            document.getElementById('searchInput').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // 新增：从用户列表跳转到文章管理并筛选该用户的文章
        function goToUserArticles(email) {
            // 切换到文章管理标签页
            switchTab('articles');
            // 设置搜索框为用户邮箱
            document.getElementById('searchInput').value = email;
            // 重置平台筛选
            document.getElementById('platformFilter').value = '';
            // 获取文章列表
            fetchArticles(true);
        }

        function resetFilters() {
            document.getElementById('searchInput').value = '';
            document.getElementById('platformFilter').value = '';
            fetchArticles(true);
        }

        function loadMore() {
            // Deprecated in favor of pagination
            changeArticlePage(1);
        }

        // Event Listeners
        let debounceTimer;
        document.getElementById('searchInput').addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => fetchArticles(true), 500);
        });
        
        document.getElementById('platformFilter').addEventListener('change', () => fetchArticles(true));

        // Auth Functions
        function showLogin() {
            log('showLogin called');
            const loading = document.getElementById('loading');
            const main = document.getElementById('mainLayout');
            const login = document.getElementById('loginModal');
            
            if (loading) loading.style.display = 'none';
            if (main) main.style.display = 'none';
            if (login) {
                login.style.display = 'flex';
                log('loginModal display set to flex');
            } else {
                log('ERROR: loginModal not found!');
            }
        }

        function showChangePassword() {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('mainLayout').style.display = 'none';
            document.getElementById('loginModal').style.display = 'none';
            document.getElementById('changePwdModal').style.display = 'flex';
        }
        
        function logout() {
            localStorage.removeItem('memoraid_admin_token');
            localStorage.removeItem('memoraid_admin_must_change_pwd');
            window.location.reload();
        }

        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            const errorDiv = document.getElementById('loginError');
            btn.disabled = true; btn.textContent = '登录中...'; errorDiv.style.display = 'none';

            try {
                const res = await fetch('/auth/admin/login', {
                    method: 'POST',
                    body: JSON.stringify({
                        username: document.getElementById('username').value,
                        password: document.getElementById('password').value
                    })
                });
                
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || '登录失败');
                
                localStorage.setItem('memoraid_admin_token', data.token);
                if (data.user.mustChangePassword) {
                    localStorage.setItem('memoraid_admin_must_change_pwd', 'true');
                    showChangePassword();
                } else {
                    localStorage.removeItem('memoraid_admin_must_change_pwd');
                    document.getElementById('loginModal').style.display = 'none';
                    document.getElementById('loading').style.display = 'block';
                    init();
                }
            } catch (e) {
                errorDiv.textContent = e.message; errorDiv.style.display = 'block';
            } finally {
                btn.disabled = false; btn.textContent = '登录';
            }
        });

        document.getElementById('changePwdForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const oldPwd = document.getElementById('oldPwd').value;
            const newPwd = document.getElementById('newPwd').value;
            const confirmPwd = document.getElementById('confirmPwd').value;
            const errorDiv = document.getElementById('changePwdError');

            if (newPwd !== confirmPwd) {
                errorDiv.textContent = '两次输入的新密码不一致'; errorDiv.style.display = 'block'; return;
            }

            const btn = e.target.querySelector('button');
            btn.disabled = true; btn.textContent = '提交中...'; errorDiv.style.display = 'none';

            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const res = await fetch('/auth/admin/change-password', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd })
                });
                
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || '修改失败');
                
                localStorage.removeItem('memoraid_admin_must_change_pwd');
                alert('密码修改成功');
                document.getElementById('changePwdModal').style.display = 'none';
                document.getElementById('loading').style.display = 'block';
                init();
            } catch (e) {
                errorDiv.textContent = e.message; errorDiv.style.display = 'block';
            } finally {
                btn.disabled = false; btn.textContent = '修改并继续';
            }
        });

        // Tab Switching
        function switchTab(tabId) {
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            const navEl = document.getElementById('nav-' + tabId);
            if (navEl) navEl.classList.add('active');
            
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            const tabEl = document.getElementById('tab-' + tabId);
            if (tabEl) tabEl.style.display = 'block';
            
            // 修复：切换到仪表盘时加载数据趋势图表和平台趋势图
            if (tabId === 'dashboard') {
                loadDashboardCharts();
                loadPlatformTrendsChart();
            }
            
            if (tabId === 'orders' && !window.ordersLoaded) {
                fetchOrders(true);
                window.ordersLoaded = true;
            }
            
            // 加载排行榜数据
            if (tabId === 'leaderboards' && !window.leaderboardsLoaded) {
                fetchLeaderboards();
                window.leaderboardsLoaded = true;
            }
            
            // 加载用户反馈数据（工单系统）
            if (tabId === 'feedback' && !window.feedbackLoaded) {
                loadAdminTickets();
                window.feedbackLoaded = true;
            }
            
            if (tabId === 'settings') {
                fetchEmailConfig();
            }
            
            history.pushState(null, null, '#' + tabId);
        }

        // Orders Logic
        let ordersPage = 1;
        const ordersLimit = 20;
        
        async function fetchOrders(reset = false) {
            if (reset) ordersPage = 1;
            const status = document.getElementById('orderStatusFilter').value;
            // 获取搜索关键词（订单号或用户邮箱）
            const keyword = document.getElementById('orderKeyword')?.value?.trim() || '';
            const offset = (ordersPage - 1) * ordersLimit;
            
            const tbody = document.getElementById('ordersTable');
            if (reset) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">加载中...</td></tr>';
            
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                let url = '/api/admin/orders?limit=' + ordersLimit + '&offset=' + offset;
                if (status) url += '&status=' + status;
                // 传递搜索关键词
                if (keyword) url += '&keyword=' + encodeURIComponent(keyword);
                
                const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
                if (res.status === 401) { showLogin(); return; }
                const data = await res.json();
                
                tbody.innerHTML = '';
                if (!data.orders || data.orders.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">暂无记录</td></tr>';
                    return;
                }
                
                data.orders.forEach(order => {
                    const date = new Date(order.created_at * 1000).toLocaleString();
                    const statusMap = {
                        'pending': '<span class="status-pill pending">待支付</span>',
                        'approved': '<span class="status-pill paid">已支付</span>',
                        'rejected': '<span class="status-pill cancelled">已取消</span>',
                        'paid': '<span class="status-pill paid">已支付</span>',
                        'cancelled': '<span class="status-pill cancelled">已取消</span>'
                    };
                    const paymentChannel = order.payment_url && String(order.payment_url).startsWith('http')
                        ? '微信支付'
                        : (order.payment_url || '-');
                    
                    const row = \`
                        <tr>
                            <!-- 订单号：自适应宽度，超长时省略号折叠，点击复制 -->
                            <td>
                                <span onclick="copyText('\${order.id}', this)" title="点击复制: \${order.id}" style="cursor:pointer;font-family:monospace;font-size:0.75rem;color:var(--accent-secondary);text-decoration:underline dotted;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(200px,20vw)">
                                    \${order.id}
                                </span>
                            </td>
                            <!-- 用户：点击复制邮箱 -->
                            <td>
                                <div class="user-cell" onclick="copyText('\${order.user_email || order.user_id}', this.querySelector('.user-email'))" style="cursor:pointer" title="点击复制">
                                    <div class="user-email" style="color:var(--accent-secondary);text-decoration:underline dotted;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(180px,18vw)">\${order.user_email || order.user_id}</div>
                                </div>
                            </td>
                            <td style="font-weight:600">¥\${order.amount}</td>
                            <td>\${order.quota_amount}次</td>
                            <td>\${statusMap[order.status] || order.status}</td>
                            <td>\${paymentChannel}</td>
                            <td style="font-size:0.8rem;color:var(--text-muted)">\${date}</td>
                        </tr>
                    \`;
                    tbody.innerHTML += row;
                });
                
                const total = data.total;
                const totalPages = Math.ceil(total / ordersLimit) || 1;
                document.getElementById('orderPageInfo').textContent = \`第 \${ordersPage} / \${totalPages} 页 (共 \${total} 条)\`;
                document.getElementById('prevOrdersBtn').disabled = ordersPage <= 1;
                document.getElementById('nextOrdersBtn').disabled = ordersPage >= totalPages;
                
            } catch (e) {
                console.error(e);
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:red">加载失败</td></tr>';
            }
        }
        
        async function changeOrderPage(delta) {
            ordersPage += delta;
            await fetchOrders();
        }
        
        // 排行榜相关函数
        async function fetchLeaderboards() {
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const res = await fetch('/api/admin/leaderboards?limit=10', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                if (!res.ok) {
                    throw new Error('Failed to fetch leaderboards');
                }
                
                const data = await res.json();
                renderLeaderboards(data);
            } catch (e) {
                console.error('Failed to fetch leaderboards:', e);
                // 显示错误信息
                ['articlesLeaderboard', 'tokensLeaderboard', 'rechargeLeaderboard'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.innerHTML = '<div style="text-align:center;padding:40px;color:red">加载失败</div>';
                });
            }
        }

        // 渲染排行榜数据
        function renderLeaderboards(data) {
            // 排名徽章映射
            const rankBadges = {
                1: '🥇',
                2: '🥈', 
                3: '🥉'
            };

            // 1. 渲染文章数量排行榜
            const articlesEl = document.getElementById('articlesLeaderboard');
            if (data.articles && data.articles.length > 0) {
                articlesEl.innerHTML = data.articles.map((item, index) => {
                    const rank = index + 1;
                    // 修复: 避免模板字符串嵌套,使用字符串拼接
                    const badge = rankBadges[rank] || '<span style="display:inline-block;width:24px;text-align:center;font-weight:600;color:var(--text-muted)">' + rank + '</span>';
                    // 修复时间显示: publish_time可能是Unix时间戳(秒),需要乘以1000转为毫秒
                    let lastPublish = '-';
                    if (item.last_publish_time) {
                        // 如果时间戳小于一个合理的毫秒值(比如2000年),说明是秒,需要乘以1000
                        const timestamp = item.last_publish_time < 10000000000 ? item.last_publish_time * 1000 : item.last_publish_time;
                        const date = new Date(timestamp);
                        lastPublish = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
                    }
                    
                    return \`
                        <div class="leaderboard-item" style="display:flex;align-items:center;padding:12px;background:var(--bg-secondary);border-radius:8px;transition:transform 0.2s">
                            <div style="font-size:1.5rem;margin-right:12px">\${badge}</div>
                            <div style="flex:1;min-width:0">
                                <div style="font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${item.email}">\${item.email}</div>
                                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">最近发布: \${lastPublish}</div>
                            </div>
                            <div style="text-align:right;margin-left:12px">
                                <div style="font-size:1.25rem;font-weight:600;color:var(--accent)">\${item.article_count}</div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">篇文章</div>
                            </div>
                        </div>
                    \`;
                }).join('');
            } else {
                articlesEl.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af">暂无数据</div>';
            }

            // 2. 渲染 Token 消耗排行榜
            const tokensEl = document.getElementById('tokensLeaderboard');
            if (data.tokens && data.tokens.length > 0) {
                tokensEl.innerHTML = data.tokens.map((item, index) => {
                    const rank = index + 1;
                    // 修复: 避免模板字符串嵌套
                    const badge = rankBadges[rank] || '<span style="display:inline-block;width:24px;text-align:center;font-weight:600;color:var(--text-muted)">' + rank + '</span>';
                    const totalTokens = item.total_tokens ? item.total_tokens.toLocaleString() : '0';
                    
                    return \`
                        <div class="leaderboard-item" style="display:flex;align-items:center;padding:12px;background:var(--bg-secondary);border-radius:8px;transition:transform 0.2s">
                            <div style="font-size:1.5rem;margin-right:12px">\${badge}</div>
                            <div style="flex:1;min-width:0">
                                <div style="font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${item.email}">\${item.email}</div>
                                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">\${item.article_count} 篇文章</div>
                            </div>
                            <div style="text-align:right;margin-left:12px">
                                <div style="font-size:1.25rem;font-weight:600;color:var(--accent)">\${totalTokens}</div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">Tokens</div>
                            </div>
                        </div>
                    \`;
                }).join('');
            } else {
                tokensEl.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af">暂无数据</div>';
            }

            // 3. 渲染充值金额排行榜
            const rechargeEl = document.getElementById('rechargeLeaderboard');
            if (data.recharge && data.recharge.length > 0) {
                rechargeEl.innerHTML = data.recharge.map((item, index) => {
                    const rank = index + 1;
                    // 修复: 避免模板字符串嵌套
                    const badge = rankBadges[rank] || '<span style="display:inline-block;width:24px;text-align:center;font-weight:600;color:var(--text-muted)">' + rank + '</span>';
                    const totalAmount = item.total_amount ? '¥' + item.total_amount.toFixed(2) : '¥0.00';
                    // 修复时间显示: paid_at可能是Unix时间戳(秒),需要乘以1000转为毫秒
                    let lastRecharge = '-';
                    if (item.last_recharge_time) {
                        // 如果时间戳小于一个合理的毫秒值,说明是秒,需要乘以1000
                        const timestamp = item.last_recharge_time < 10000000000 ? item.last_recharge_time * 1000 : item.last_recharge_time;
                        const date = new Date(timestamp);
                        lastRecharge = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
                    }
                    
                    return \`
                        <div class="leaderboard-item" style="display:flex;align-items:center;padding:12px;background:var(--bg-secondary);border-radius:8px;transition:transform 0.2s">
                            <div style="font-size:1.5rem;margin-right:12px">\${badge}</div>
                            <div style="flex:1;min-width:0">
                                <div style="font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${item.email}">\${item.email}</div>
                                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">最近充值: \${lastRecharge}</div>
                            </div>
                            <div style="text-align:right;margin-left:12px">
                                <div style="font-size:1.25rem;font-weight:600;color:var(--accent)">\${totalAmount}</div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">\${item.order_count} 笔订单</div>
                            </div>
                        </div>
                    \`;
                }).join('');
            } else {
                rechargeEl.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af">暂无数据</div>';
            }
        }

        // ==================== 用户反馈相关函数 ====================
        
        // 获取反馈列表
        let currentFeedbackPage = 1;
        async function fetchFeedback(reset = false) {
            if (reset) currentFeedbackPage = 1;
            
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const type = document.getElementById('feedbackTypeFilter').value;
                const status = document.getElementById('feedbackStatusFilter').value;
                
                const params = new URLSearchParams({
                    page: currentFeedbackPage,
                    pageSize: 20,
                    type: type,
                    status: status
                });
                
                const res = await fetch('/api/admin/feedback?' + params, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                if (!res.ok) throw new Error('Failed to fetch feedback');
                
                const data = await res.json();
                renderFeedbackList(data);
                renderFeedbackPagination(data);
            } catch (e) {
                console.error('Fetch feedback error:', e);
                document.getElementById('feedbackList').innerHTML = 
                    '<div style="text-align:center;padding:40px;color:var(--text-muted)">加载失败: ' + e.message + '</div>';
            }
        }
        
        // 渲染反馈列表
        function renderFeedbackList(data) {
            const container = document.getElementById('feedbackList');
            
            if (!data.list || data.list.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af">暂无反馈</div>';
                return;
            }
            
            // 反馈类型映射
            const typeMap = {
                'experience': { label: '使用体验', color: '#3b82f6', icon: '😊' },
                'suggestion': { label: '优化建议', color: '#10b981', icon: '💡' },
                'bug': { label: '问题反馈', color: '#ef4444', icon: '🐛' }
            };
            
            // 状态映射
            const statusMap = {
                'pending': { label: '待处理', color: '#f59e0b', bg: '#fef3c7' },
                'resolved': { label: '已解决', color: '#10b981', bg: '#d1fae5' },
                'ignored': { label: '已忽略', color: '#6b7280', bg: '#f3f4f6' }
            };
            
            container.innerHTML = data.list.map(item => {
                const typeInfo = typeMap[item.type] || { label: item.type, color: '#6b7280', icon: '📝' };
                const statusInfo = statusMap[item.status] || { label: item.status, color: '#6b7280', bg: '#f3f4f6' };
                const userEmail = item.user_email_from_users || item.user_email || '匿名用户';
                const createdAt = new Date(item.created_at * 1000).toLocaleString('zh-CN');
                
                const adminReplyHtml = item.admin_reply ? 
                    '<div style="padding:12px;background:#f8fafc;border-left:3px solid #10b981;border-radius:4px;margin-bottom:12px">' +
                    '<div style="font-size:0.75rem;color:#9ca3af;margin-bottom:4px">管理员回复：</div>' +
                    '<p style="margin:0;color:#0f172a;line-height:1.6;white-space:pre-wrap">' + item.admin_reply + '</p>' +
                    '</div>' : '';
                
                const escapedContent = item.content.replace(/'/g, "\\\\'");
                const escapedReply = (item.admin_reply || '').replace(/'/g, "\\\\'");
                
                return '<div style="border-bottom:1px solid #e2e8f0;padding:16px;transition:background 0.2s" onmouseover="this.style.background=&apos;#f1f5f9&apos;" onmouseout="this.style.background=&apos;transparent&apos;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">' +
                    '<div style="display:flex;gap:8px;align-items:center">' +
                    '<span style="font-size:1.25rem">' + typeInfo.icon + '</span>' +
                    '<span style="padding:4px 12px;border-radius:12px;font-size:0.75rem;font-weight:500;color:' + typeInfo.color + ';background:' + typeInfo.color + '20">' +
                    typeInfo.label +
                    '</span>' +
                    '<span style="padding:4px 12px;border-radius:12px;font-size:0.75rem;font-weight:500;color:' + statusInfo.color + ';background:' + statusInfo.bg + '">' +
                    statusInfo.label +
                    '</span>' +
                    '</div>' +
                    '<span style="font-size:0.75rem;color:#9ca3af">' + createdAt + '</span>' +
                    '</div>' +
                    '<div style="margin-bottom:8px">' +
                    '<span style="font-size:0.875rem;color:#64748b">👤 ' + userEmail + '</span>' +
                    '</div>' +
                    '<div style="padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:12px">' +
                    '<p style="margin:0;color:#0f172a;line-height:1.6;white-space:pre-wrap">' + item.content + '</p>' +
                    '</div>' +
                    adminReplyHtml +
                    '<div style="display:flex;gap:8px">' +
                    '<button onclick="updateFeedbackStatus(' + item.id + ', &apos;resolved&apos;)" class="btn-sm btn-success" ' + (item.status === 'resolved' ? 'disabled' : '') + '>' +
                    '✅ 标记已解决' +
                    '</button>' +
                    '<button onclick="updateFeedbackStatus(' + item.id + ', &apos;ignored&apos;)" class="btn-sm btn-outline" ' + (item.status === 'ignored' ? 'disabled' : '') + '>' +
                    '🚫 忽略' +
                    '</button>' +
                    '<button onclick="showReplyModal(' + item.id + ', &apos;' + escapedContent + '&apos;, &apos;' + escapedReply + '&apos;)" class="btn-sm btn-outline">' +
                    '💬 回复' +
                    '</button>' +
                    '</div>' +
                    '</div>';
            }).join('');
        }
        
        // 渲染分页
        function renderFeedbackPagination(data) {
            const container = document.getElementById('feedbackPagination');
            if (data.totalPages <= 1) {
                container.innerHTML = '';
                return;
            }
            
            let html = '<div style="display:flex;gap:8px;justify-content:center;align-items:center">';
            
            // 上一页
            if (data.page > 1) {
                html += '<button onclick="currentFeedbackPage=' + (data.page - 1) + ';fetchFeedback()" class="btn-sm btn-outline">上一页</button>';
            }
            
            // 页码
            html += '<span style="color:#64748b">第 ' + data.page + ' / ' + data.totalPages + ' 页</span>';
            
            // 下一页
            if (data.page < data.totalPages) {
                html += '<button onclick="currentFeedbackPage=' + (data.page + 1) + ';fetchFeedback()" class="btn-sm btn-outline">下一页</button>';
            }
            
            html += '</div>';
            container.innerHTML = html;
        }
        
        // 更新反馈状态
        async function updateFeedbackStatus(feedbackId, status) {
            // 移除确认弹窗，直接执行
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const res = await fetch('/api/admin/feedback/' + feedbackId + '/status', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ status })
                });
                
                if (!res.ok) throw new Error('更新失败');
                
                // 移除alert，直接刷新列表
                fetchFeedback();
            } catch (e) {
                console.error('更新失败:', e);
                // 移除alert，静默失败
                fetchFeedback();
            }
        }
        
        // 显示回复弹窗
        function showReplyModal(feedbackId, content, existingReply) {
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000';
            
            modal.innerHTML = 
                '<div style="background:white;border-radius:12px;padding:24px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto">' +
                '<h3 style="margin:0 0 16px 0;font-size:1.25rem;font-weight:600">回复用户反馈</h3>' +
                '<div style="padding:12px;background:var(--bg-secondary);border-radius:8px;margin-bottom:16px">' +
                '<p style="margin:0;color:var(--text);line-height:1.6;white-space:pre-wrap">' + content + '</p>' +
                '</div>' +
                '<textarea id="replyContent" placeholder="输入回复内容..." style="width:100%;min-height:120px;padding:12px;border:1px solid var(--border);border-radius:8px;resize:vertical;font-family:inherit" >' + existingReply + '</textarea>' +
                '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">' +
                '<button onclick="this.closest(&apos;[style*=fixed]&apos;).remove()" class="btn-sm btn-outline">取消</button>' +
                '<button onclick="submitReply(' + feedbackId + ')" class="btn-sm btn-primary">提交回复</button>' +
                '</div>' +
                '</div>';
            
            document.body.appendChild(modal);
        }
        
        // 提交回复
        async function submitReply(feedbackId) {
            const replyContent = document.getElementById('replyContent').value.trim();
            
            // 移除alert，改为在按钮上显示状态
            if (!replyContent) {
                return;
            }
            
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const res = await fetch('/api/admin/feedback/' + feedbackId + '/status', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        status: 'resolved',
                        adminReply: replyContent
                    })
                });
                
                if (!res.ok) throw new Error('提交失败');
                
                // 移除alert，直接关闭弹窗并刷新
                document.querySelector('[style*="position:fixed"]').remove();
                fetchFeedback();
            } catch (e) {
                console.error('提交失败:', e);
                // 移除alert，静默失败
            }
        }

        // ========== 管理员工单管理函数 ==========
        
        // 加载管理员工单列表
        async function loadAdminTickets() {
            const container = document.getElementById('adminTicketsList');
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af">加载中...</div>';
            
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const statusFilter = document.getElementById('ticketStatusFilter').value;
                
                let url = '/api/admin/tickets';
                const res = await fetch(url, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await res.json();
                
                if (!res.ok) {
                    throw new Error(data.error || '加载工单列表失败');
                }
                
                let tickets = data.tickets || [];
                
                // 前端筛选状态
                if (statusFilter !== 'all') {
                    tickets = tickets.filter(t => t.status === statusFilter);
                }
                
                if (tickets.length === 0) {
                    container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af">暂无工单</div>';
                    return;
                }
                
                const statusMap = {
                    'open': { text: '待处理', color: '#f59e0b' },
                    'replied': { text: '已回复', color: '#10b981' },
                    'closed': { text: '已关闭', color: '#6b7280' }
                };
                
                let html = '<div class="table-wrapper"><table><thead><tr><th>工单编号</th><th>用户</th><th>主题</th><th>状态</th><th>消息数</th><th>创建时间</th><th>操作</th></tr></thead><tbody>';
                
                tickets.forEach(ticket => {
                    const status = statusMap[ticket.status] || statusMap['open'];
                    const hasNewMessage = ticket.message_count > ticket.admin_reply_count && ticket.status === 'open';
                    
                    html += '<tr>';
                    html += '<td>#' + ticket.id + '</td>';
                    html += '<td>' + (ticket.user_email || '未知用户') + '</td>';
                    html += '<td>' + ticket.subject + (hasNewMessage ? ' <span style="color:#ef4444;font-weight:600">●</span>' : '') + '</td>';
                    html += '<td><span style="padding:4px 12px;border-radius:12px;font-size:0.75rem;font-weight:500;color:' + status.color + ';background:' + status.color + '20">' + status.text + '</span></td>';
                    html += '<td>' + ticket.message_count + ' 条</td>';
                    html += '<td>' + new Date(ticket.created_at).toLocaleString('zh-CN') + '</td>';
                    html += '<td><button class="btn-sm btn-outline" onclick="viewAdminTicketDetail(' + ticket.id + ')">查看详情</button></td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table></div>';
                container.innerHTML = html;
            } catch (e) {
                console.error('加载工单列表失败:', e);
                container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af">加载失败: ' + e.message + '</div>';
            }
        }
        
        let currentAdminTicketId = null;
        
        // 查看管理员工单详情
        async function viewAdminTicketDetail(ticketId) {
            currentAdminTicketId = ticketId;
            document.getElementById('adminTicketDetailModal').style.display = 'flex';
            document.getElementById('adminTicketReplyMessage').value = '';
            
            const container = document.getElementById('adminTicketDetailContent');
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af">加载中...</div>';
            
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const res = await fetch('/api/admin/tickets/' + ticketId, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await res.json();
                
                if (!res.ok) {
                    throw new Error(data.error || '加载工单详情失败');
                }
                
                const ticket = data.ticket;
                const messages = data.messages || [];
                
                const statusMap = {
                    'open': { text: '待处理', color: '#f59e0b' },
                    'replied': { text: '已回复', color: '#10b981' },
                    'closed': { text: '已关闭', color: '#6b7280' }
                };
                const status = statusMap[ticket.status] || statusMap['open'];
                
                let html = '<div style="margin-bottom: 24px; padding: 20px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">';
                html += '<div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">';
                html += '<div><h3 style="margin: 0 0 8px; font-size: 20px; color: #0f172a;">工单 #' + ticket.id + ': ' + ticket.subject + '</h3>';
                html += '<div style="font-size: 14px; color: #9ca3af;">用户: ' + (ticket.user_email || '未知用户') + '</div></div>';
                html += '<span style="padding:6px 16px;border-radius:12px;font-size:0.875rem;font-weight:600;color:' + status.color + ';background:' + status.color + '20">' + status.text + '</span>';
                html += '</div>';
                html += '<div style="font-size: 13px; color: #9ca3af;">创建时间: ' + new Date(ticket.created_at).toLocaleString('zh-CN') + '</div>';
                html += '</div>';
                
                html += '<div style="max-height: 450px; overflow-y: auto; padding: 4px;">';
                messages.forEach(msg => {
                    const isAdmin = msg.is_admin === 1;
                    const bgColor = isAdmin ? '#dbeafe' : '#f3f4f6';
                    const align = isAdmin ? 'left' : 'right';
                    const label = isAdmin ? '👨‍💼 客服回复' : '👤 用户';
                    const labelColor = isAdmin ? '#0284c7' : '#6b7280';
                    
                    html += '<div style="margin-bottom: 20px; text-align: ' + align + ';">';
                    html += '<div style="display: inline-block; max-width: 75%; text-align: left;">';
                    html += '<div style="font-size: 12px; color: ' + labelColor + '; margin-bottom: 6px; font-weight: 600;">' + label + '</div>';
                    html += '<div style="padding: 14px; background: ' + bgColor + '; border-radius: 12px; word-wrap: break-word; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">';
                    html += msg.message.replace(/\\n/g, '<br>');
                    html += '</div>';
                    html += '<div style="font-size: 11px; color: #9ca3af; margin-top: 6px;">' + new Date(msg.created_at).toLocaleString('zh-CN') + '</div>';
                    html += '</div></div>';
                });
                html += '</div>';
                
                container.innerHTML = html;
                
                // 设置状态选择器的当前值
                document.getElementById('adminTicketStatusSelect').value = ticket.status === 'closed' ? 'closed' : 'replied';
            } catch (e) {
                console.error('加载工单详情失败:', e);
                container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af">加载失败: ' + e.message + '</div>';
            }
        }
        
        // 关闭管理员工单详情弹窗
        function closeAdminTicketDetailModal() {
            document.getElementById('adminTicketDetailModal').style.display = 'none';
            currentAdminTicketId = null;
        }
        
        // 提交管理员工单回复
        async function submitAdminTicketReply() {
            if (!currentAdminTicketId) {
                alert('工单ID未找到');
                return;
            }
            
            const message = document.getElementById('adminTicketReplyMessage').value.trim();
            
            if (!message) {
                alert('请输入回复内容');
                return;
            }
            
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const res = await fetch('/api/admin/tickets/' + currentAdminTicketId + '/reply', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message })
                });
                
                const data = await res.json();
                
                if (!res.ok) {
                    throw new Error(data.error || '发送回复失败');
                }
                
                // 更新工单状态
                const newStatus = document.getElementById('adminTicketStatusSelect').value;
                await fetch('/api/admin/tickets/' + currentAdminTicketId + '/status', {
                    method: 'PATCH',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ status: newStatus })
                });
                
                document.getElementById('adminTicketReplyMessage').value = '';
                viewAdminTicketDetail(currentAdminTicketId); // 重新加载工单详情
                loadAdminTickets(); // 刷新工单列表
            } catch (e) {
                console.error('发送回复失败:', e);
                alert('发送回复失败: ' + e.message);
            }
        }

        async function fetchEmailConfig() {
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const res = await fetch('/api/admin/config/email', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data) {
                        document.getElementById('email_sender').value = data.email_sender || '';
                        document.getElementById('email_sender_name').value = data.email_sender_name || 'Memoraid';
                        document.getElementById('email_recipient').value = data.email_recipient || '';
                    }
                }
            } catch (e) {
                console.error('Failed to fetch email config', e);
            }
        }

        async function saveEmailConfig(e) {
            e.preventDefault();
            const btn = e.submitter;
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = '保存中...';
            
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const body = {
                    email_sender: document.getElementById('email_sender').value,
                    email_sender_name: document.getElementById('email_sender_name').value,
                    email_recipient: document.getElementById('email_recipient').value
                };
                
                const res = await fetch('/api/admin/config/email', {
                    method: 'POST',
                    headers: { 
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });
                
                // 保存成功时静默结束，避免后台频繁配置时反复弹窗打断操作。
                if (!res.ok) {
                    alert('保存失败');
                }
            } catch (e) {
                alert('网络错误');
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }

        async function testEmailConfig() {
            const btn = document.querySelector('button[onclick="testEmailConfig()"]');
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = '发送中...';
            
            try {
                const token = localStorage.getItem('memoraid_admin_token');
                const res = await fetch('/api/admin/config/email/test', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await res.json();
                if (res.ok) {
                    alert('测试邮件已发送，请检查通知邮箱或发件人邮箱（包括垃圾邮件文件夹）');
                } else {
                    alert('测试失败: ' + (data.error || '未知错误'));
                }
            } catch (e) {
                alert('网络错误: ' + e.message);
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }

        async function init() {
            log('init started');
            const token = localStorage.getItem('memoraid_admin_token');
            if (!token) {
                log('No token found, showing login');
                showLogin();
                return;
            }
            if (localStorage.getItem('memoraid_admin_must_change_pwd') === 'true') {
                log('Must change password');
                showChangePassword();
                return;
            }
            
            log('Token found, fetching stats');
            document.getElementById('loading').style.display = 'block';
            document.getElementById('mainLayout').style.display = 'flex';
            
            // Initial data fetch
            await fetchStats();
            await fetchUsers(true);
            await fetchArticles(true);
            // 加载仪表盘趋势图表和平台趋势图
            loadDashboardCharts();
            loadPlatformTrendsChart();
            
            // Setup routing
            const hash = window.location.hash.slice(1) || 'dashboard';
            switchTab(hash);
            log('init completed');
        }
        
        init().catch(e => {
            console.error(e);
            log('INIT ERROR: ' + e.message);
            document.getElementById('loading').style.display = 'none';
            document.getElementById('globalError').style.display = 'block';
            document.getElementById('globalError').textContent = '初始化失败: ' + e.message;
        });
    </script>
</body>
</html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
    }

    // 7.0.4 GET /api/admin/orders - 获取订单列表
    if (url.pathname === '/api/admin/orders' && request.method === 'GET') {
        try {
            const userId = getUserIdFromRequest(request);
            if (!userId) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
            if (!admin) {
                return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            const status = url.searchParams.get('status');
            const keyword = url.searchParams.get('keyword'); // 搜索关键词：订单号或用户邮箱
            const limit = parseInt(url.searchParams.get('limit') || '20');
            const offset = parseInt(url.searchParams.get('offset') || '0');

            let query = `
                SELECT o.*, u.email as user_email
                FROM payment_orders o
                LEFT JOIN users u ON o.user_id = u.id
            `;
            const params: any[] = [];
            const conditions: string[] = [];

            // 兼容历史 approved / rejected 状态，后台统一按支付结果筛选。
            if (status === 'paid') {
                conditions.push('(o.status = ? OR o.status = ?)');
                params.push('paid', 'approved');
            } else if (status === 'cancelled') {
                conditions.push('(o.status = ? OR o.status = ?)');
                params.push('cancelled', 'rejected');
            } else if (status) {
                conditions.push('o.status = ?');
                params.push(status);
            }
            // 按关键词搜索：匹配订单号或用户邮箱
            if (keyword) {
                conditions.push('(o.id LIKE ? OR u.email LIKE ?)');
                params.push(`%${keyword}%`, `%${keyword}%`);
            }

            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }

            query += ` ORDER BY o.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

            const orders = await env.DB.prepare(query).bind(...params).all();
            
            // 获取总数（同样需要应用过滤条件）
            let countQuery = `
                SELECT COUNT(*) as total
                FROM payment_orders o
                LEFT JOIN users u ON o.user_id = u.id
            `;
            const countParams: any[] = [];
            const countConditions: string[] = [];

            if (status === 'paid') {
                countConditions.push('(o.status = ? OR o.status = ?)');
                countParams.push('paid', 'approved');
            } else if (status === 'cancelled') {
                countConditions.push('(o.status = ? OR o.status = ?)');
                countParams.push('cancelled', 'rejected');
            } else if (status) {
                countConditions.push('o.status = ?');
                countParams.push(status);
            }
            if (keyword) {
                countConditions.push('(o.id LIKE ? OR u.email LIKE ?)');
                countParams.push(`%${keyword}%`, `%${keyword}%`);
            }
            if (countConditions.length > 0) {
                countQuery += ' WHERE ' + countConditions.join(' AND ');
            }

            const total = await env.DB.prepare(countQuery).bind(...countParams).first('total');

            return new Response(JSON.stringify({ orders: orders.results, total }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
    }

    // 7.0.6 GET /api/admin/config/email - 获取邮箱配置
    if (url.pathname === '/api/admin/config/email' && request.method === 'GET') {
        try {
            const userId = getUserIdFromRequest(request);
            if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

            const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
            if (!admin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });

            // Create table if not exists (lazy migration)
            await env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS system_configs (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
                )
            `).run();

            const configs = await env.DB.prepare('SELECT * FROM system_configs WHERE key LIKE "email_%"').all();
            const result: any = {};
            configs.results.forEach((row: any) => {
                result[row.key] = row.value;
            });

            return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
        }
    }

    // 7.0.7 POST /api/admin/config/email - 保存邮箱配置
    if (url.pathname === '/api/admin/config/email' && request.method === 'POST') {
        try {
            const userId = getUserIdFromRequest(request);
            if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

            const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
            if (!admin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });

            const body = await request.json() as any;
            // 支付成功邮件和管理员到账通知共用这组邮箱配置。
            const keys = ['email_sender', 'email_sender_name', 'email_recipient'];
            
            const stmt = env.DB.prepare(`
                INSERT INTO system_configs (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            `);
            
            const batch = [];
            for (const key of keys) {
                if (body[key] !== undefined) {
                    batch.push(stmt.bind(key, body[key], Math.floor(Date.now() / 1000)));
                }
            }
            
            if (batch.length > 0) await env.DB.batch(batch);

            return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
        }
    }

    // 7.0.7.1 POST /api/admin/config/email/test - 测试邮箱配置
    if (url.pathname === '/api/admin/config/email/test' && request.method === 'POST') {
        try {
            const userId = getUserIdFromRequest(request);
            if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

            const admin = await env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(userId).first();
            if (!admin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });

            const { emailSender, emailSenderName, notificationEmail } = await loadEmailConfig(env);

            if (!emailSender) {
                return new Response(JSON.stringify({ error: '请先保存发件人邮箱配置' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            // 检查Resend API Key是否配置
            if (!env.RESEND_API_KEY) {
                return new Response(JSON.stringify({ 
                    error: 'Resend API Key未配置',
                    detail: '请在Cloudflare Workers环境变量中配置RESEND_API_KEY'
                }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            // 优先把测试邮件发到管理员通知邮箱，便于直接验证到账提醒链路。
            const emailResponse = await sendEmailViaResend(env.RESEND_API_KEY, {
                from: emailSender,
                fromName: emailSenderName,
                to: notificationEmail || emailSender,
                subject: '[Memoraid] 测试邮件',
                text: '这是一封测试邮件，证明邮件配置正确。\n\n如果您收到此邮件，说明邮件发送功能正常工作。\n\n本邮件通过Resend服务发送。',
                html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #10b981 0%, #a78bfa 100%); padding: 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">
                                📧 Memoraid
                            </h1>
                            <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">
                                邮件系统测试
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <div style="display: inline-block; background: linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(167,139,250,0.1) 100%); padding: 20px; border-radius: 50%; margin-bottom: 20px;">
                                    <span style="font-size: 48px;">✅</span>
                                </div>
                                <h2 style="margin: 0 0 12px 0; color: #111827; font-size: 24px; font-weight: 600;">
                                    测试邮件发送成功
                                </h2>
                                <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">
                                    恭喜！您的邮件配置已正确设置
                                </p>
                            </div>
                            
                            <div style="background-color: #f9fafb; border-left: 4px solid #10b981; padding: 16px 20px; border-radius: 6px; margin: 24px 0;">
                                <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">
                                    <strong>✨ 提示：</strong>如果您收到此邮件，说明邮件发送功能正常工作。系统现在可以发送支付成功通知等邮件了。
                                </p>
                            </div>
                            
                            <div style="margin: 30px 0; padding: 20px; background-color: #fafafa; border-radius: 8px;">
                                <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 16px; font-weight: 600;">
                                    📋 邮件服务信息
                                </h3>
                                <table width="100%" cellpadding="8" cellspacing="0" style="font-size: 14px;">
                                    <tr>
                                        <td style="color: #6b7280; width: 120px;">邮件服务</td>
                                        <td style="color: #111827; font-weight: 500;">Resend</td>
                                    </tr>
                                    <tr>
                                        <td style="color: #6b7280;">发送时间</td>
                                        <td style="color: #111827; font-weight: 500;">${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}</td>
                                    </tr>
                                    <tr>
                                        <td style="color: #6b7280;">状态</td>
                                        <td style="color: #10b981; font-weight: 600;">✓ 正常运行</td>
                                    </tr>
                                </table>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 24px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                            <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 13px;">
                                本邮件由 <strong style="color: #111827;">Memoraid</strong> 自动发送
                            </p>
                            <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                                © ${new Date().getFullYear()} Memoraid. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
                `.trim(),
            });

            if (!emailResponse.ok) {
                const errorText = await emailResponse.text();
                console.error('Resend error:', errorText);
                return new Response(JSON.stringify({ 
                    error: '发送失败: ' + (errorText || emailResponse.statusText),
                    detail: '请检查Resend API Key是否正确，以及发件人邮箱是否已验证'
                }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            return new Response(JSON.stringify({ success: true, message: '测试邮件已发送到发件人邮箱，请检查收件箱' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } catch (e: any) {
            console.error('Test email failed:', e);
            return new Response(JSON.stringify({ error: '发送失败: ' + e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
    }

    // 7.0.8.1 POST /api/payment/callback/xunhupay - 虎皮椒支付异步回调
    if (url.pathname === '/api/payment/callback/xunhupay' && request.method === 'POST') {
        try {
            const xunhupayConfig = getXunhupayConfig(env);
            if (!xunhupayConfig) {
                return new Response('config missing', { status: 500, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
            }

            const formData = await request.formData();
            const callbackPayload = Object.fromEntries(
                Array.from(formData.entries()).map(([key, value]) => [key, String(value)])
            ) as Record<string, string>;

            const callbackHash = callbackPayload.hash;
            const expectedHash = buildXunhupayHash(callbackPayload, xunhupayConfig.appSecret);
            if (!callbackHash || callbackHash !== expectedHash) {
                return new Response('invalid sign', { status: 400, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
            }

            const orderId = callbackPayload.trade_order_id;
            if (!orderId) {
                return new Response('missing order id', { status: 400, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
            }

            const order = await env.DB.prepare('SELECT * FROM payment_orders WHERE id = ?').bind(orderId).first<PaymentOrderRow>();
            if (!order) {
                return new Response('order not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
            }

            const callbackAmount = Number(callbackPayload.total_fee || 0);
            if (Math.abs(callbackAmount - Number(order.amount)) > 0.001) {
                return new Response('amount mismatch', { status: 400, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
            }

            if ((callbackPayload.status || '').toUpperCase() !== 'OD') {
                console.log('忽略未完成支付回调:', callbackPayload);
                return new Response('success', { headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
            }

            await settleRechargeOrder(env, orderId, 'paid');
            return new Response('success', { headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
        } catch (e: any) {
            console.error('Xunhupay callback failed:', e);
            return new Response('error', { status: 500, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
        }
    }

    // 7.0.8.2 GET /api/payment/status - 查询订单支付状态
    if (url.pathname === '/api/payment/status' && request.method === 'GET') {
        try {
            const orderId = url.searchParams.get('orderId');
            if (!orderId) {
                return new Response(JSON.stringify({ error: '缺少订单号' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const order = await env.DB.prepare('SELECT id, amount, quota_amount, status, created_at, paid_at FROM payment_orders WHERE id = ?')
                .bind(orderId)
                .first<{
                    id: string;
                    amount: number;
                    quota_amount: number;
                    status: string;
                    created_at: number;
                    paid_at?: number | null;
                }>();

            if (!order) {
                return new Response(JSON.stringify({ error: '订单不存在' }), {
                    status: 404,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify({
                orderId: order.id,
                amount: Number(order.amount),
                quota: Number(order.quota_amount),
                status: order.status,
                isPaid: order.status === 'paid' || order.status === 'approved',
                createdAt: order.created_at,
                paidAt: order.paid_at || null,
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }

    // 7.0.8.3 GET /api/payment/history - 获取用户充值记录（分页）
    if (url.pathname === '/api/payment/history' && request.method === 'GET') {
        try {
            const userId = getUserIdFromRequest(request);
            if (!userId) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const limit = parseInt(url.searchParams.get('limit') || '20');
            const offset = parseInt(url.searchParams.get('offset') || '0');

            // 获取总数
            const countResult = await env.DB.prepare(
                'SELECT COUNT(*) as total FROM payment_orders WHERE user_id = ?'
            ).bind(userId).first<{ total: number }>();
            const total = countResult?.total || 0;

            // 获取记录列表
            const records = await env.DB.prepare(
                'SELECT id, amount, quota_amount, status, created_at, paid_at FROM payment_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
            ).bind(userId, limit, offset).all();

            return new Response(JSON.stringify({
                records: records.results || [],
                total,
                limit,
                offset
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }

    // 7.0.8.4 GET /api/task-execution-logs - 获取定时任务执行记录（分页，支持按task_id筛选）
    if (url.pathname === '/api/task-execution-logs' && request.method === 'GET') {
        try {
            const userId = getUserIdFromRequest(request);
            if (!userId) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const limit = parseInt(url.searchParams.get('limit') || '20');
            const offset = parseInt(url.searchParams.get('offset') || '0');
            const taskId = url.searchParams.get('task_id'); // 可选：按任务ID筛选

            // 构建查询条件
            let whereClause = 'WHERE user_id = ?';
            const params = [userId];
            
            if (taskId) {
                whereClause += ' AND task_id = ?';
                params.push(taskId);
            }

            // 获取总数
            const countResult = await env.DB.prepare(
                `SELECT COUNT(*) as total FROM task_execution_logs ${whereClause}`
            ).bind(...params).first<{ total: number }>();
            const total = countResult?.total || 0;

            // 获取记录列表
            const logs = await env.DB.prepare(
                `SELECT id, task_id, task_name, status, started_at, completed_at, duration, articles_generated, articles_published, error_message FROM task_execution_logs ${whereClause} ORDER BY started_at DESC LIMIT ? OFFSET ?`
            ).bind(...params, limit, offset).all();

            return new Response(JSON.stringify({
                logs: logs.results || [],
                total,
                limit,
                offset
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }

    // 7.0.8.5 GET /api/scheduled-tasks/list - 获取用户的定时任务列表
    // 注意：此接口与 /api/scheduled-tasks 返回相同格式的数据，保持兼容性
    if (url.pathname === '/api/scheduled-tasks/list' && request.method === 'GET') {
        try {
            const userId = getUserIdFromRequest(request);
            if (!userId) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // 获取用户的所有定时任务
            const tasks = await env.DB.prepare(
                'SELECT * FROM scheduled_tasks WHERE user_id = ? ORDER BY created_at DESC'
            ).bind(userId).all();

            // 将数据库字段转换为前端需要的格式（与 /api/scheduled-tasks 保持一致）
            const formattedTasks = (tasks.results || []).map((task: any) => ({
                id: task.id,
                enabled: task.enabled === 1,
                name: task.name,
                scheduleType: task.schedule_type,
                hour: task.hour,
                minute: task.minute,
                executionTimes: task.execution_times ? JSON.parse(task.execution_times) : undefined,
                weekdays: task.weekdays ? JSON.parse(task.weekdays) : undefined,
                intervalMinutes: task.interval_minutes,
                newsSourceType: task.news_source_type,
                newsSourceUrl: task.news_source_url,
                tophubNodeId: task.tophub_node_id,
                categories: JSON.parse(task.categories || '[]'),
                platforms: JSON.parse(task.platforms || '[]'),
                articleCount: task.article_count || 1,
                customPrompt: task.custom_prompt || '',
                notificationEmail: task.notification_email || '',
                lastRunTime: task.last_run_time,
                lastRunStatus: task.last_run_status,
                lastRunError: task.last_run_error,
                createdAt: task.created_at,
            }));

            return new Response(JSON.stringify({
                tasks: formattedTasks,
                total: formattedTasks.length
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }

    // 7.0.10 GET /payment/return - 虎皮椒支付同步跳转页
    if (url.pathname === '/payment/return' && request.method === 'GET') {
        const orderId = url.searchParams.get('orderId') || '';
        const safeOrderId = orderId.replace(/[^a-zA-Z0-9_-]/g, '');

        return buildHtmlResponse(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>支付结果 - Memoraid</title>
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:linear-gradient(135deg,#ecfeff 0%,#f0fdf4 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{max-width:520px;width:100%;background:#fff;border-radius:24px;padding:32px;box-shadow:0 20px 60px rgba(15,23,42,.12);text-align:center}
    .icon{font-size:56px;line-height:1;margin-bottom:20px}
    .title{font-size:28px;font-weight:700;color:#0f172a;margin:0 0 12px}
    .desc{font-size:15px;line-height:1.8;color:#475569;margin:0 0 20px}
    .status{background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:16px 18px;margin-bottom:20px;color:#334155;font-size:14px}
    .order{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#0f172a;font-size:13px;word-break:break-all}
    .actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
    .btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px}
    .btn-primary{background:#10b981;color:#fff}
    .btn-ghost{background:#fff;color:#0f172a;border:1px solid #cbd5e1}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">💳</div>
    <h1 class="title">正在确认支付结果</h1>
    <p class="desc">支付成功后，系统会自动为您的账户充值额度。通常 1 - 5 秒内完成，请不要重复支付。</p>
    <div class="status" id="statusBox">
      <div id="statusText">正在查询订单状态...</div>
      <div class="order">订单号：${safeOrderId || '未提供'}</div>
    </div>
    <div class="actions">
      <a class="btn btn-primary" href="/user">返回内容中心</a>
      <button class="btn btn-ghost" id="refreshBtn" type="button">刷新状态</button>
    </div>
  </div>
  <script>
    const orderId = ${JSON.stringify(safeOrderId)};
    const statusText = document.getElementById('statusText');
    const refreshBtn = document.getElementById('refreshBtn');
    let pollTimer = null;
    let pollCount = 0;

    function updateStatus(text, ok) {
      statusText.textContent = text;
      statusText.style.color = ok ? '#059669' : '#334155';
    }

    async function checkStatus() {
      if (!orderId) {
        updateStatus('缺少订单号，请返回内容中心查看。', false);
        return;
      }

      try {
        const res = await fetch('/api/payment/status?orderId=' + encodeURIComponent(orderId));
        const data = await res.json();
        if (!res.ok) {
          updateStatus(data.error || '订单查询失败，请稍后重试。', false);
          return;
        }

        if (data.isPaid) {
          updateStatus('支付成功，额度已自动到账。', true);
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          setTimeout(() => {
            window.location.href = '/user';
          }, 1800);
          return;
        }

        updateStatus('订单已创建，正在等待支付完成...', false);
      } catch (error) {
        updateStatus('网络波动，暂时无法查询订单状态。', false);
      }
    }

    refreshBtn.addEventListener('click', checkStatus);
    checkStatus();
    pollTimer = setInterval(() => {
      pollCount += 1;
      if (pollCount > 20) {
        clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      checkStatus();
    }, 3000);
  </script>
</body>
</html>`);
    }

    // 7.1 GET /user - 内容数据中心 (深色主题，需要登录)
    if (url.pathname === '/user' && request.method === 'GET') {
      const ASSETS_BASE = effectiveOrigin + '/assets/memoraid';
      const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Memoraid · 内容数据中心</title>
    <link rel="icon" type="image/png" href="${ASSETS_BASE}/icon-128.png">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #ffffff;
            --bg-subtle: #f8fafc;
            --bg-muted: #f3f4f6;
            --surface: #ffffff;
            --border: #e5e7eb;
            --border-light: #eef2f7;
            --text: #0f172a;
            --text-secondary: #334155;
            --text-muted: #64748b;
            --accent: #111827;
            --accent-secondary: #10b981;
            --gradient-1: linear-gradient(135deg, rgba(16,185,129,.18) 0%, rgba(167,139,250,.14) 100%);
            --gradient-2: linear-gradient(135deg, #111827 0%, #0f172a 100%);
            --coral: #f97316;
            --rose: #f43f5e;
            --violet: #a78bfa;
            --sky: #38bdf8;
            --amber: #fbbf24;
            --emerald: #34d399;
            --shadow-sm: 0 1px 2px rgba(2, 6, 23, 0.06);
            --shadow: 0 8px 24px rgba(2, 6, 23, 0.08);
            --shadow-lg: 0 14px 38px rgba(2, 6, 23, 0.10);
            --radius: 12px;
            --radius-lg: 20px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body {
            font-family: 'Inter', 'Noto Sans SC', system-ui, sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }
        
        /* 背景装饰 */
        .bg-glow {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            pointer-events: none; z-index: 0;
            background: 
                radial-gradient(800px 400px at 30% -10%, rgba(16,185,129,.18) 0%, transparent 60%),
                radial-gradient(900px 450px at 80% 10%, rgba(167,139,250,.14) 0%, transparent 60%);
        }
        
        /* 顶部导航 */
        .topbar {
            position: sticky; top: 0; z-index: 100;
            background: rgba(255, 255, 255, 0.82);
            backdrop-filter: blur(14px);
            border-bottom: 1px solid var(--border);
            padding: 0 24px;
        }
        .topbar-inner {
            max-width: 1440px; margin: 0 auto;
            display: flex; align-items: center; justify-content: space-between;
            height: 64px;
        }
        .logo {
            display: flex; align-items: center; gap: 10px;
            font-weight: 600; font-size: 1.1rem; color: var(--text);
            text-decoration: none;
        }
        .logo-icon {
            width: 40px; height: 40px; border-radius: 12px;
            background: var(--bg-subtle);
            border: 1px solid var(--border);
            display: flex; align-items: center; justify-content: center;
            box-shadow: var(--shadow-sm);
            overflow: hidden;
            flex-shrink: 0;
        }
        .logo-icon img { width: 40px; height: 40px; object-fit: cover; }
        .logo-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .logo-name {
            font-weight: 600;
            font-size: 1.1rem;
            color: var(--text);
        }
        .logo-subtitle {
            font-size: 0.7rem;
            color: var(--text-muted);
            font-weight: 400;
        }
        .topbar-actions { display: flex; align-items: center; gap: 12px; }
        .user-info {
            display: flex; align-items: center; gap: 10px;
            padding: 6px 12px;
            background: var(--bg-subtle);
            border: 1px solid var(--border);
            border-radius: 12px;
            font-size: 0.85rem;
            color: var(--text-secondary);
            flex-wrap: wrap;
        }
        .user-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .user-name {
            font-weight: 600;
            color: var(--text);
        }
        .quota-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 10px;
            border-radius: 999px;
            font-size: 0.75rem;
            font-weight: 600;
            line-height: 1;
            border: 1px solid transparent;
        }
        .quota-chip.free {
            background: rgba(16, 185, 129, 0.1);
            color: #047857;
            border-color: rgba(16, 185, 129, 0.18);
        }
        .quota-chip.paid {
            background: rgba(15, 23, 42, 0.08);
            color: #0f172a;
            border-color: rgba(15, 23, 42, 0.12);
        }
        .user-avatar {
            width: 28px; height: 28px;
            border-radius: 50%;
            background: var(--gradient-2);
            display: flex; align-items: center; justify-content: center;
            font-size: 0.75rem; color: white; font-weight: 600;
        }
        .btn {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 8px 16px; border-radius: 8px;
            font-size: 0.875rem; font-weight: 500;
            cursor: pointer; transition: all 0.2s;
            border: none; background: transparent;
            color: var(--text);
        }
        .btn-ghost { color: var(--text-secondary); }
        .btn-ghost:hover { background: var(--bg-muted); color: var(--text); }
        .btn-logout {
            color: var(--rose);
        }
        .btn-logout:hover { background: rgba(244, 63, 94, 0.1); }
        
        /* 主容器 */
        .container { 
            max-width: 1800px; /* 增加最大宽度以容纳更多列 */
            margin: 0 auto; 
            padding: 32px 24px; 
            height: calc(100vh - 64px);
        }
        
        /* 主布局：左侧导航 + 右侧内容 */
        .layout { 
            display: flex; 
            height: 100%; 
        }
        
        /* 侧边栏 */
        .sidebar { 
            width: 260px; 
            background: var(--surface); 
            border-right: 1px solid var(--border); 
            display: flex; 
            flex-direction: column; 
            flex-shrink: 0; 
            z-index: 10;
            border-radius: var(--radius-lg);
            overflow: hidden;
        }
        .sidebar-nav { 
            padding: 24px 16px; 
            flex: 1; 
            display: flex; 
            flex-direction: column; 
            gap: 8px; 
            overflow-y: auto; 
        }
        .nav-item { 
            display: flex; 
            align-items: center; 
            gap: 12px; 
            padding: 12px 16px; 
            border-radius: 8px; 
            color: var(--text-secondary); 
            cursor: pointer; 
            text-decoration: none; 
            font-weight: 500; 
            transition: all 0.2s; 
        }
        .nav-item:hover { 
            background: var(--bg-muted); 
            color: var(--text); 
        }
        .nav-item.active { 
            background: var(--bg-subtle); 
            color: var(--accent); 
            font-weight: 600; 
            box-shadow: 0 1px 2px rgba(0,0,0,0.05); 
        }
        
        /* 内容区 */
        .main-content { 
            flex: 1; 
            overflow-y: auto; 
            background: var(--bg-subtle); 
            position: relative; 
            border-radius: var(--radius-lg);
            margin-left: 24px;
        }
        .content-body { 
            padding: 32px; 
            max-width: 1600px; 
            margin: 0 auto; 
            width: 100%; 
        }
        
        /* Tab切换 */
        .tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 0;
        }
        .tab-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 20px;
            border: none;
            background: transparent;
            color: var(--text-secondary);
            font-size: 0.9rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            border-bottom: 2px solid transparent;
            position: relative;
            top: 1px;
        }
        .tab-item:hover {
            color: var(--text);
            background: var(--bg-subtle);
        }
        .tab-item.active {
            color: var(--accent);
            border-bottom-color: var(--accent);
        }
        .tab-badge {
            background: var(--bg-muted);
            padding: 2px 8px;
            border-radius: 100px;
            font-size: 0.75rem;
            color: var(--text-muted);
            font-weight: 600;
        }
        .tab-item.active .tab-badge {
            background: rgba(17, 24, 39, 0.1);
            color: var(--accent);
        }
        
        /* Tab内容 */
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        
        /* 分页 */
        .pagination {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-top: 24px;
        }
        .pagination-btn {
            padding: 8px 16px;
            border-radius: 8px;
            border: 1px solid var(--border);
            background: var(--surface);
            color: var(--text-secondary);
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .pagination-btn:hover:not(:disabled) {
            border-color: var(--accent);
            color: var(--text);
        }
        .pagination-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .pagination-btn.active {
            background: var(--gradient-2);
            color: white;
            border-color: transparent;
        }
        .pagination-info {
            color: var(--text-muted);
            font-size: 0.875rem;
            padding: 0 12px;
        }
        
        /* 筛选工具栏 */
        .filter-toolbar {
            display: flex;
            gap: 32px;
            margin-bottom: 24px;
            flex-wrap: wrap;
        }
        .filter-section {
            flex: 1;
            min-width: 200px;
        }
        .filter-label {
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 12px;
        }
        .filter-tags {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .filter-tag {
            padding: 8px 16px;
            border-radius: 100px;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid var(--border);
            background: var(--surface);
            color: var(--text-secondary);
        }
        .filter-tag:hover {
            border-color: var(--accent);
            color: var(--text);
        }
        .filter-tag.active {
            background: var(--gradient-2);
            color: white;
            border-color: transparent;
        }
        
        /* 页面标题区 */
        .page-header { margin-bottom: 40px; }
        .page-title {
            font-size: 2rem; font-weight: 700; color: var(--text);
            letter-spacing: -0.02em; margin-bottom: 8px;
        }
        .page-subtitle { color: var(--text-muted); font-size: 1rem; }
        
        /* 筛选标签 */
        .filter-section { margin-bottom: 32px; }
        .filter-label {
            font-size: 0.75rem; font-weight: 600;
            color: var(--text-muted); text-transform: uppercase;
            letter-spacing: 0.05em; margin-bottom: 12px;
        }
        .filter-tags { display: flex; gap: 8px; flex-wrap: wrap; }
        .filter-tag {
            padding: 8px 16px; border-radius: 100px;
            font-size: 0.875rem; font-weight: 500;
            cursor: pointer; transition: all 0.2s;
            border: 1px solid var(--border);
            background: var(--surface); color: var(--text-secondary);
        }
        .filter-tag:hover { border-color: var(--accent); color: var(--text); }
        .filter-tag.active {
            background: var(--gradient-2); color: white;
            border-color: transparent;
        }
        
        /* 内容区块 */
        .content-section { margin-bottom: 48px; }
        .section-header {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 20px;
        }
        .section-title {
            font-size: 1.125rem; font-weight: 600; color: var(--text);
            display: flex; align-items: center; gap: 8px;
        }
        .section-title .count {
            background: var(--border-light);
            padding: 2px 10px; border-radius: 100px;
            font-size: 0.75rem; color: var(--text-muted);
        }
        
        /* 文章表格 */
        .table-wrapper {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            overflow: hidden;
        }
        .data-table { width: 100%; border-collapse: collapse; }
        .data-table th {
            text-align: left; padding: 14px 20px;
            font-size: 0.75rem; font-weight: 600;
            color: var(--text-muted); text-transform: uppercase;
            letter-spacing: 0.04em;
            background: var(--bg-subtle); border-bottom: 1px solid var(--border);
        }
        .data-table td {
            padding: 16px 20px;
            border-bottom: 1px solid var(--border);
            font-size: 0.9rem;
        }
        .data-table tr:last-child td { border-bottom: none; }
        .data-table tr:hover { background: var(--bg-muted); }
        .article-title {
            font-weight: 500; color: var(--text);
            text-decoration: none; display: block;
            max-width: 360px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            transition: color 0.2s;
        }
        .article-title:hover { color: var(--accent); }
        .platform-cell {
            display: flex; align-items: center; gap: 6px;
            font-size: 0.85rem; color: var(--text-secondary);
        }
        .stat-pill {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 4px 10px; border-radius: 6px;
            font-size: 0.8rem; font-weight: 500;
            background: var(--bg-muted);
        }
        .time-cell { color: var(--text-muted); font-size: 0.85rem; }
        
        /* 操作按钮 */
        .action-btn {
            padding: 6px 12px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--surface);
            color: var(--text-secondary);
            font-size: 0.8rem;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .action-btn:hover {
            background: var(--bg-muted);
            border-color: var(--accent);
            color: var(--accent);
        }
        
        /* 空状态 */
        .empty-state {
            text-align: center; padding: 80px 20px;
            color: var(--text-muted);
        }
        .empty-icon {
            width: 80px; height: 80px; margin: 0 auto 20px;
            background: var(--bg-muted); border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 2.5rem; opacity: 0.6;
        }
        .empty-text { font-size: 1rem; }
        
        /* 加载状态 */
        .loading-state {
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            padding: 60px 20px; gap: 16px;
        }
        .spinner {
            width: 32px; height: 32px;
            border: 3px solid var(--border);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .loading-text { color: var(--text-muted); font-size: 0.9rem; }
        
        /* 登录遮罩 */
        .auth-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: var(--bg);
            display: flex; align-items: center; justify-content: center;
            z-index: 9999;
        }
        .auth-message {
            text-align: center;
        }
        .auth-message h2 {
            font-size: 1.5rem; margin-bottom: 16px;
        }
        .auth-message p {
            color: var(--text-secondary); margin-bottom: 24px;
        }
        .auth-message .btn-login {
            display: inline-flex; align-items: center; gap: 8px;
            padding: 14px 28px; border-radius: 12px;
            background: var(--gradient-2);
            color: white; font-size: 1rem; font-weight: 600;
            text-decoration: none; transition: all 0.3s;
        }
        .auth-message .btn-login:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(34, 211, 238, 0.3);
        }
        
        /* 动画 */
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .fade-in { animation: fadeIn 0.4s ease forwards; }
        .delay-1 { animation-delay: 0.1s; opacity: 0; }
        .delay-2 { animation-delay: 0.2s; opacity: 0; }
        .delay-3 { animation-delay: 0.3s; opacity: 0; }
        
        /* 响应式 */
        @media (max-width: 768px) {
            .topbar-inner {
                height: auto;
                min-height: 64px;
                padding: 12px 0;
                align-items: flex-start;
            }
            .topbar-actions {
                justify-content: flex-end;
                flex-wrap: wrap;
            }
            .logo-subtitle {
                display: none;
            }
            .layout {
                flex-direction: column;
            }
            .sidebar {
                width: 100%;
                border-right: none;
                border-bottom: 1px solid var(--border);
                margin-bottom: 16px;
            }
            .main-content {
                margin-left: 0;
            }
            .table-wrapper { overflow-x: auto; }
            .data-table { min-width: 640px; }
            .container { padding: 24px 16px; }
        }
        .btn-recharge {
            background: var(--gradient-2);
            color: white;
            padding: 8px 20px;
            border-radius: 8px;
            font-size: 0.875rem;
            font-weight: 600;
            text-decoration: none;
            border: none;
            cursor: pointer;
            transition: opacity 0.2s;
            display: inline-flex; align-items: center; gap: 6px;
        }
        .btn-recharge:hover { opacity: 0.9; transform: translateY(-1px); }

        /* 充值弹窗 */
        .modal-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.6);
            display: flex; align-items: center; justify-content: center;
            z-index: 1000;
            backdrop-filter: blur(4px);
            opacity: 0; pointer-events: none; transition: opacity 0.3s;
        }
        .modal-overlay.active { opacity: 1; pointer-events: auto; }
        .modal {
            background: var(--surface);
            padding: 0;
            border-radius: 24px;
            max-width: 480px;
            width: 90%;
            box-shadow: var(--shadow-lg);
            transform: translateY(20px); transition: transform 0.3s;
            overflow: hidden;
        }
        .modal-overlay.active .modal { transform: translateY(0); }
        .modal-header {
            padding: 24px;
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid var(--border-light);
            background: var(--bg-subtle);
        }
        .modal-title { font-size: 1.125rem; font-weight: 700; color: var(--text); }
        .close-btn { 
            cursor: pointer; padding: 8px; border-radius: 50%; 
            color: var(--text-muted); transition: all 0.2s;
            display: flex; align-items: center; justify-content: center;
        }
        .close-btn:hover { background: rgba(0,0,0,0.05); color: var(--text); }
        .modal-body { padding: 24px; }
        .pay-rate {
            text-align: center;
            color: var(--text-secondary);
            font-size: 0.95rem;
            background: rgba(16,185,129,0.1);
            border: 1px solid rgba(16,185,129,0.2);
            color: #059669;
            padding: 12px;
            border-radius: 12px;
            margin-bottom: 24px;
        }
        .pay-rate strong { font-weight: 700; font-size: 1.1rem; }
        .pay-methods {
            display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
        }
        .pay-method-card {
            text-align: center;
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 16px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .pay-method-card:hover {
            border-color: var(--accent);
            background: var(--bg-subtle);
        }
        .plan-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin-bottom: 24px;
        }
        .plan-card {
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px 8px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
        }
        .plan-card:hover {
            border-color: var(--accent);
            background: rgba(37,99,235,0.05);
        }
        .plan-card.active {
            border-color: var(--accent);
            background: rgba(37,99,235,0.1);
            box-shadow: 0 0 0 1px var(--accent);
        }
        .plan-amount {
            font-size: 1.2rem;
            font-weight: 700;
            color: var(--text);
            margin-bottom: 4px;
        }
        .plan-quota {
            font-size: 0.9rem;
            color: var(--text-secondary);
        }
        .qr-img {
            width: 100%; aspect-ratio: 1; object-fit: contain;
            border-radius: 8px; margin-bottom: 12px;
            background: white;
            padding: 8px;
            border: 1px solid var(--border-light);
        }
        .pay-method-name { font-weight: 600; font-size: 0.9rem; color: var(--text); }
        .modal-footer {
            padding: 16px 24px;
            background: var(--bg-subtle);
            border-top: 1px solid var(--border-light);
            text-align: center;
            font-size: 0.8rem; color: var(--text-muted);
        }
        
        /* 支付步骤样式 */
        .pay-step-1 { display: block; }
        .pay-step-2 { display: none; }
        .pay-step-2 .qr-container { text-align: center; margin-top: 16px; }
        .pay-step-2 .order-info { 
            background: var(--bg-muted); 
            padding: 12px; 
            border-radius: 8px; 
            margin: 16px 0; 
            font-size: 0.9rem;
            color: var(--text-secondary);
            text-align: left;
        }
        .pay-step-2 .order-id { font-family: monospace; font-weight: 700; color: var(--accent); user-select: all; }
        .btn-confirm-pay {
            width: 100%;
            padding: 12px;
            background: var(--gradient-2);
            color: white;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 16px;
            white-space: normal;
            line-height: 1.4;
            height: auto;
            min-height: 44px;
        }
        .btn-confirm-pay:hover { opacity: 0.9; }

        @media (max-width: 768px) {
            .user-info {
                max-width: calc(100vw - 144px);
            }
            .user-meta {
                gap: 6px;
            }
            .quota-chip {
                font-size: 0.7rem;
            }
        }
    </style>
</head>
<body>
    <div class="bg-glow"></div>
    
    <!-- 登录验证遮罩 -->
    <div class="auth-overlay" id="authOverlay">
        <div class="auth-message">
            <div class="spinner" style="margin: 0 auto 20px;"></div>
            <h2>验证登录状态...</h2>
        </div>
    </div>
    
    <!-- 顶部导航 -->
    <nav class="topbar">
        <div class="topbar-inner">
            <a href="/" class="logo">
                <div class="logo-icon">
                    <img src="${ASSETS_BASE}/icon-128.png" alt="M">
                </div>
                <div class="logo-text">
                    <span class="logo-name">Memoraid</span>
                    <span class="logo-subtitle">内容数据中心 · 专注文章与额度管理</span>
                </div>
            </a>
            <div class="topbar-actions">
                <div class="user-info" id="userInfo" style="display:none;">
                    <div class="user-avatar" id="userAvatar" onclick="changeAvatar()" title="点击更换头像" style="cursor: pointer; padding: 0; overflow: hidden; background: transparent;"></div>
                    <div class="user-meta">
                        <span class="user-name" id="userEmail">user</span>
                        <span class="quota-chip free">免费 <strong id="freeQuotaInline">-</strong></span>
                        <span class="quota-chip paid">付费 <strong id="paidQuotaInline">-</strong></span>
                    </div>
                </div>
                <button class="btn-recharge" onclick="openRechargeModal()">充值</button>
                <button class="btn btn-ghost" onclick="loadData()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                    刷新
                </button>
                <button class="btn btn-logout" onclick="logout()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    退出
                </button>
            </div>
        </div>
    </nav>
    
    <main class="container">
        <div class="layout">
            <!-- 左侧导航菜单 -->
            <aside class="sidebar">
                <nav class="sidebar-nav" style="padding-top: 24px;">
                    <a href="#articles" class="nav-item active" id="nav-articles">
                        <span>📝</span> 文章列表
                    </a>
                    <a href="#tasks" class="nav-item" id="nav-tasks">
                        <span>⏰</span> 定时任务
                    </a>
                    <a href="#recharge" class="nav-item" id="nav-recharge">
                        <span>💰</span> 充值记录
                    </a>
                    <a href="#tickets" class="nav-item" id="nav-tickets">
                        <span>💬</span> 工单反馈
                    </a>
                </nav>
            </aside>
            
            <!-- 右侧主内容区 -->
            <div class="main-content">
                <div class="content-body">
                    <!-- 平台筛选（在表格上方，支持多选） -->
                    <div class="platform-filter-bar" id="platformFilterBar" style="display:none; margin-bottom: 20px;">
                        <div class="filter-label" style="margin-bottom: 12px;">平台筛选（可多选）</div>
                        <div class="filter-tags" id="platformFilters">
                            <div class="loading-text">加载中...</div>
                        </div>
                    </div>
                    
                    <!-- 文章列表内容 -->
                    <section class="tab-content active" id="articlesContent">
                        <div class="table-wrapper" id="articlesTable">
                            <div class="loading-state"><div class="spinner"></div><div class="loading-text">加载中...</div></div>
                        </div>
                        <div class="pagination" id="articlesPagination"></div>
                    </section>
                    
                    <!-- 定时任务内容 -->
                    <section class="tab-content" id="tasksContent">
                        <div class="table-wrapper" id="tasksTable">
                            <div class="loading-state"><div class="spinner"></div><div class="loading-text">加载中...</div></div>
                        </div>
                    </section>
                    
                    <!-- 充值记录内容 -->
                    <section class="tab-content" id="rechargeContent">
                        <div class="table-wrapper" id="rechargeTable">
                            <div class="loading-state"><div class="spinner"></div><div class="loading-text">加载中...</div></div>
                        </div>
                        <div class="pagination" id="rechargePagination"></div>
                    </section>
                    
                    <!-- 工单反馈内容 -->
                    <section class="tab-content" id="ticketsContent">
                        <div style="margin-bottom: 20px;">
                            <button class="btn btn-primary" onclick="showCreateTicketModal()" style="padding: 10px 20px; font-size: 14px;">
                                <span>➕</span> 创建新工单
                            </button>
                        </div>
                        <div class="table-wrapper" id="ticketsTable">
                            <div class="loading-state"><div class="spinner"></div><div class="loading-text">加载中...</div></div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    </main>

    <!-- 创建工单弹窗 -->
    <div class="modal-overlay" id="createTicketModal" onclick="if(event.target === this) closeCreateTicketModal()">
        <div class="modal" style="max-width: 600px;">
            <div class="modal-header">
                <div class="modal-title">创建工单</div>
                <div class="close-btn" onclick="closeCreateTicketModal()">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </div>
            </div>
            <div class="modal-body">
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text);">主题</label>
                    <input type="text" id="ticketSubject" placeholder="请输入工单主题" style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px;">
                </div>
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text);">详细描述</label>
                    <textarea id="ticketMessage" placeholder="请详细描述您的问题或建议" rows="6" style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; resize: vertical;"></textarea>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button class="btn btn-ghost" onclick="closeCreateTicketModal()">取消</button>
                    <button class="btn btn-primary" onclick="submitTicket()">提交工单</button>
                </div>
            </div>
        </div>
    </div>

    <!-- 工单详情弹窗 -->
    <div class="modal-overlay" id="ticketDetailModal" onclick="if(event.target === this) closeTicketDetailModal()">
        <div class="modal" style="max-width: 800px; max-height: 80vh;">
            <div class="modal-header">
                <div class="modal-title">工单详情</div>
                <div class="close-btn" onclick="closeTicketDetailModal()">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </div>
            </div>
            <div class="modal-body" style="max-height: calc(80vh - 120px); overflow-y: auto;">
                <div id="ticketDetailContent">
                    <div class="loading-state"><div class="spinner"></div><div class="loading-text">加载中...</div></div>
                </div>
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border);">
                    <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text);">添加回复</label>
                    <textarea id="ticketReplyMessage" placeholder="输入您的回复..." rows="4" style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; resize: vertical;"></textarea>
                    <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
                        <button class="btn btn-primary" onclick="submitTicketReply()">发送回复</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 充值弹窗 -->
    <div class="modal-overlay" id="rechargeModal" onclick="if(event.target === this) closeRechargeModal()">
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">充值付费额度</div>
                <div class="close-btn" onclick="closeRechargeModal()">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </div>
            </div>
            <div class="modal-body">
                <!-- 步骤1：选择充值金额 -->
                <div id="payStep0" style="display:block;">
                    <div style="margin-bottom:16px;font-weight:600;color:var(--text)">选择充值套餐</div>
                    <div class="plan-grid">
                        <div class="plan-card active" onclick="selectPlan(9.9, this)">
                            <div class="plan-amount">¥9.9</div>
                            <div class="plan-quota">30篇</div>
                        </div>
                        <div class="plan-card" onclick="selectPlan(29.9, this)">
                            <div class="plan-amount">¥29.9</div>
                            <div class="plan-quota">100篇</div>
                        </div>
                        <div class="plan-card" onclick="selectPlan(49.9, this)">
                            <div class="plan-amount">¥49.9</div>
                            <div class="plan-quota">200篇</div>
                        </div>
                    </div>
                    <button class="btn-confirm-pay" style="margin-top:24px" onclick="createOrder(this)">立即支付</button>
                </div>

                <!-- 步骤2：展示虎皮椒支付二维码 -->
                <div class="pay-step-2" id="payStep2" style="display:none;">
                    <div style="text-align: center; margin-bottom: 12px; font-weight: 600;">
                        请使用微信支付完成付款
                    </div>

                    <div style="max-width: 200px; margin: 0 auto;">
                        <img id="payQrCode" src="" style="width: 100%; border-radius: 8px; border: 1px solid var(--border);">
                    </div>

                    <div id="paymentStatusText" style="text-align:center;color:var(--text-secondary);font-size:0.95rem;line-height:1.8;margin:20px 0 12px;">
                        系统会自动检查付款状态，请稍等...
                    </div>

                    <button class="btn-confirm-pay" id="checkPaymentBtn" style="margin-top:12px;background:linear-gradient(135deg,#0f172a 0%,#334155 100%)" onclick="checkPaymentStatus(this)">未自动到账？点此刷新状态</button>
                    <div style="text-align: center; margin-top: 12px;">
                        <span onclick="resetPayment()" style="font-size: 0.8rem; color: var(--text-muted); cursor: pointer; text-decoration: underline;">选择其他金额</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        const API_BASE = '';
        let currentPlatform = []; // 改为数组，支持多选
        let currentSortBy = 'time'; // 排序方式：time 或 token
        let currentSortOrder = 'desc'; // 排序顺序：desc 或 asc
        let currentTab = 'articles'; // 当前Tab：articles、tasks 或 recharge
        let userEmail = '';
        let selectedAmount = 10;
        
        // 分页状态（仅文章列表和充值记录需要分页）
        let articlesPage = 1;
        let articlesPageSize = 20;
        let articlesTotalCount = 0;
        let rechargePage = 1;
        let rechargePageSize = 20;
        let rechargeTotalCount = 0;
        let tasksTotalCount = 0; // 定时任务总数（不需要分页）
        
        // 检查登录状态
        async function checkAuth() {
            const token = localStorage.getItem('memoraid_token');
            const email = localStorage.getItem('memoraid_email');
            
            if (!token) {
                showLoginRequired();
                return false;
            }
            
            try {
                const res = await fetch(API_BASE + '/api/auth/verify', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                
                if (!data.authenticated) {
                    localStorage.removeItem('memoraid_token');
                    localStorage.removeItem('memoraid_email');
                    showLoginRequired();
                    return false;
                }
                
                // 登录成功，显示用户信息
                userEmail = data.email || email || 'User';
                const emailPrefix = userEmail.includes('@') ? userEmail.split('@')[0] : userEmail;
                document.getElementById('userEmail').textContent = emailPrefix;
                
                // Avatar logic
                let avatarSeed = localStorage.getItem('user_avatar_seed');
                if (!avatarSeed) {
                    avatarSeed = userEmail;
                    localStorage.setItem('user_avatar_seed', avatarSeed);
                }
                updateAvatarDisplay(avatarSeed);
                document.getElementById('userInfo').style.display = 'flex';
                document.getElementById('authOverlay').style.display = 'none';
                return true;
            } catch (e) {
                console.error('Auth check failed:', e);
                showLoginRequired();
                return false;
            }
        }
        
        // 显示需要登录
        function showLoginRequired() {
            document.getElementById('authOverlay').innerHTML = 
                '<div class="auth-message">' +
                    '<h2>需要登录</h2>' +
                    '<p>请先登录以访问管理后台</p>' +
                    '<a href="/login" class="btn-login">' +
                        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>' +
                        '前往登录' +
                    '</a>' +
                '</div>';
        }
        
        // 退出登录
        function logout() {
            localStorage.removeItem('memoraid_token');
            localStorage.removeItem('memoraid_email');
            window.location.href = '/login';
        }

        function changeAvatar() {
            const newSeed = Math.random().toString(36).substring(7);
            localStorage.setItem('user_avatar_seed', newSeed);
            updateAvatarDisplay(newSeed);
        }

        function updateAvatarDisplay(seed) {
            const avatarEl = document.getElementById('userAvatar');
            if (avatarEl) {
                avatarEl.innerHTML = '<img src="https://api.dicebear.com/7.x/notionists/svg?seed=' + encodeURIComponent(seed) + '&backgroundColor=transparent" style="width: 100%; height: 100%; object-fit: cover;">';
            }
        }
        
        // 格式化数字 - 更友好的显示
        function formatNum(n) {
            if (!n || n === 0) return '0';
            if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
            if (n >= 10000) return (n / 10000).toFixed(1) + '万';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
            return n.toLocaleString();
        }
        
        // 格式化时间 - 精确到秒
        function formatTime(ts) {
            if (!ts) return '-';
            const d = new Date(ts * 1000);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hour = String(d.getHours()).padStart(2, '0');
            const minute = String(d.getMinutes()).padStart(2, '0');
            const second = String(d.getSeconds()).padStart(2, '0');
            return year + '-' + month + '-' + day + ' ' + hour + ':' + minute + ':' + second;
        }
        
        // Tab切换
        function switchTab(tab) {
            currentTab = tab;
            
            // 更新导航项状态
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            document.getElementById('nav-' + tab).classList.add('active');
            
            // 更新内容显示
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            // 显示/隐藏平台筛选栏
            const platformFilterBar = document.getElementById('platformFilterBar');
            
            if (tab === 'articles') {
                // 文章列表：显示平台筛选
                platformFilterBar.style.display = 'block';
                document.getElementById('articlesContent').classList.add('active');
                if (document.getElementById('articlesTable').innerHTML.includes('加载中')) {
                    loadArticles();
                }
            } else {
                // 其他Tab：隐藏平台筛选
                platformFilterBar.style.display = 'none';
                
                if (tab === 'tasks') {
                    document.getElementById('tasksContent').classList.add('active');
                    if (document.getElementById('tasksTable').innerHTML.includes('加载中')) {
                        loadScheduledTasks(); // 加载定时任务列表
                    }
                } else if (tab === 'recharge') {
                    document.getElementById('rechargeContent').classList.add('active');
                    if (document.getElementById('rechargeTable').innerHTML.includes('加载中')) {
                        loadRechargeHistory();
                    }
                } else if (tab === 'tickets') {
                    document.getElementById('ticketsContent').classList.add('active');
                    if (document.getElementById('ticketsTable').innerHTML.includes('加载中')) {
                        loadTickets(); // 加载工单列表
                    }
                }
            }
        }
        
        // 刷新当前Tab数据
        function loadCurrentTabData() {
            if (currentTab === 'articles') {
                loadArticles();
            } else if (currentTab === 'tasks') {
                loadScheduledTasks();
            } else if (currentTab === 'recharge') {
                loadRechargeHistory();
            }
        }
        
        // 切换排序方式
        function changeSortBy(sortBy) {
            // 如果点击同一列，切换排序顺序；如果点击不同列，默认降序
            if (currentSortBy === sortBy) {
                currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
            } else {
                currentSortBy = sortBy;
                currentSortOrder = 'desc'; // 新列默认降序
            }
            articlesPage = 1; // 重置到第一页
            
            loadArticles();
        }
        
        // 加载数据
        async function loadData() {
            const token = localStorage.getItem('memoraid_token');
            try {
                const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
                
                const [platformsRes, quotaRes] = await Promise.all([
                    fetch(API_BASE + '/api/platforms', { headers }),
                    fetch(API_BASE + '/api/user/quota', { headers })
                ]);
                
                const [platforms, quota] = await Promise.all([
                    platformsRes.json(),
                    quotaRes.json()
                ]);
                
                // 更新额度显示
                if (quota && !quota.error) {
                    document.getElementById('freeQuotaInline').textContent = quota.free_quota_remaining ?? 0;
                    document.getElementById('paidQuotaInline').textContent = quota.paid_quota_remaining ?? 0;
                }
                
                // 渲染平台筛选
                renderPlatformFilters(platforms.platforms || []);
                
                // 加载当前Tab的数据
                if (currentTab === 'articles') {
                    await loadArticles();
                } else if (currentTab === 'recharge') {
                    await loadRechargeHistory();
                }
                
            } catch (e) {
                console.error('加载数据失败:', e);
            }
        }
        
        // 加载文章列表
        async function loadArticles() {
            const token = localStorage.getItem('memoraid_token');
            if (!token) return;
            
            try {
                const headers = { 'Authorization': 'Bearer ' + token };
                const offset = (articlesPage - 1) * articlesPageSize;
                let query = '?limit=' + articlesPageSize + '&offset=' + offset;
                
                // 添加平台筛选（支持多选）
                if (currentPlatform.length > 0) {
                    query += '&platforms=' + currentPlatform.join(',');
                }
                
                const res = await fetch(API_BASE + '/api/user/articles' + query, { headers });
                const data = await res.json();
                
                let articles = data.articles || [];
                articlesTotalCount = data.total || 0;
                
                // 前端排序
                if (currentSortBy === 'token') {
                    articles.sort((a, b) => {
                        const diff = (b.totalTokens || 0) - (a.totalTokens || 0);
                        return currentSortOrder === 'desc' ? diff : -diff;
                    });
                } else {
                    // 按时间排序
                    articles.sort((a, b) => {
                        const diff = (b.publish_time || 0) - (a.publish_time || 0);
                        return currentSortOrder === 'desc' ? diff : -diff;
                    });
                }
                
                renderArticles(articles);
                renderArticlesPagination();
                
            } catch (e) {
                console.error('加载文章失败:', e);
            }
        }
        
        // 加载充值记录
        async function loadRechargeHistory() {
            const token = localStorage.getItem('memoraid_token');
            if (!token) return;
            
            try {
                const headers = { 'Authorization': 'Bearer ' + token };
                const offset = (rechargePage - 1) * rechargePageSize;
                const query = '?limit=' + rechargePageSize + '&offset=' + offset;
                
                const res = await fetch(API_BASE + '/api/payment/history' + query, { headers });
                const data = await res.json();
                
                const records = data.records || [];
                rechargeTotalCount = data.total || records.length;
                
                renderRechargeHistory(records);
                renderRechargePagination();
                
                // 注意：rechargeCount元素在新布局中已移除，不再需要更新
                
            } catch (e) {
                console.error('加载充值记录失败:', e);
                // 如果接口不存在，显示空状态
                document.getElementById('rechargeTable').innerHTML = 
                    '<div class="empty-state"><div class="empty-icon">💳</div><p class="empty-text">暂无充值记录</p></div>';
            }
        }
        
        // 加载定时任务列表（当前配置的任务）
        async function loadScheduledTasks() {
            const token = localStorage.getItem('memoraid_token');
            if (!token) return;
            
            try {
                const headers = { 'Authorization': 'Bearer ' + token };
                
                const res = await fetch(API_BASE + '/api/scheduled-tasks/list', { headers });
                const data = await res.json();
                
                const tasks = data.tasks || [];
                tasksTotalCount = tasks.length;
                
                renderScheduledTasks(tasks);
                
                // 注意：taskCount元素在新布局中已移除，不再需要更新
                
            } catch (e) {
                console.error('加载定时任务失败:', e);
                // 如果接口不存在，显示空状态
                document.getElementById('tasksTable').innerHTML = 
                    '<div class="empty-state"><div class="empty-icon">⏰</div><p class="empty-text">暂无定时任务</p></div>';
            }
        }
        
        // 渲染平台筛选标签（支持多选）
        function renderPlatformFilters(platforms) {
            const visiblePlatforms = platforms.filter(p => p && p.name && p.name !== 'test');
            
            let html = '';
            
            // 全部平台按钮
            const allActive = currentPlatform.length === 0;
            html += '<button class="filter-tag ' + (allActive ? 'active' : '') + '" onclick="filterPlatform(&quot;all&quot;)">全部平台</button>';
            
            // 各平台按钮（支持多选）
            html += visiblePlatforms.map(p => {
                const isActive = currentPlatform.includes(p.name);
                return '<button class="filter-tag ' + (isActive ? 'active' : '') + '" onclick="filterPlatform(&quot;' + p.name + '&quot;)">' + 
                    (p.icon || '📄') + ' ' + p.display_name + '</button>';
            }).join('');
            
            document.getElementById('platformFilters').innerHTML = html;
        }
        
        // 渲染文章表格（移除账号列）
        function renderArticles(articles) {
            // 注意：articleCount元素在新布局中已移除，不再需要更新
            
            if (!articles.length) {
                document.getElementById('articlesTable').innerHTML = 
                    '<div class="empty-state"><div class="empty-icon">📄</div><p class="empty-text">暂无文章数据</p></div>';
                return;
            }
            
            const rows = articles.map(a => {
                // 显示 token 消耗，鼠标悬停显示输入/输出明细
                const tokenCell = a.totalTokens != null
                    ? '<span class="stat-pill" style="background:#eef2ff;color:#4f46e5" title="输入:' + (a.promptTokens || 0) + ' 输出:' + (a.completionTokens || 0) + '">' + a.totalTokens.toLocaleString() + '</span>'
                    : '<span style="color:#9ca3af">-</span>';
                return '<tr>' +
                    '<td><a href="' + (a.article_url || '#') + '" target="_blank" class="article-title">' + (a.title || '无标题') + '</a></td>' +
                    '<td><div class="platform-cell">' + (a.platform_icon || '📄') + ' ' + (a.platform_name || '') + '</div></td>' +
                    '<td>' + tokenCell + '</td>' +
                    '<td class="time-cell">' + formatTime(a.publish_time) + '</td>' +
                '</tr>';
            }).join('');
            
            document.getElementById('articlesTable').innerHTML = 
                '<table class="data-table">' +
                    '<thead><tr>' +
                        '<th>标题</th><th>平台</th>' +
                        '<th style="cursor:pointer" onclick="changeSortBy(&quot;token&quot;)">Token ' + (currentSortBy === 'token' ? (currentSortOrder === 'desc' ? '↓' : '↑') : '') + '</th>' +
                        '<th style="cursor:pointer" onclick="changeSortBy(&quot;time&quot;)">发布时间 ' + (currentSortBy === 'time' ? (currentSortOrder === 'desc' ? '↓' : '↑') : '') + '</th>' +
                    '</tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                '</table>';
        }
        
        // 渲染充值记录（去掉状态字段）
        function renderRechargeHistory(records) {
            if (!records.length) {
                document.getElementById('rechargeTable').innerHTML = 
                    '<div class="empty-state"><div class="empty-icon">💳</div><p class="empty-text">暂无充值记录</p></div>';
                return;
            }
            
            const rows = records.map(r => {
                return '<tr>' +
                    '<td><span style="font-family:monospace;font-size:0.85rem;color:var(--text-muted)">' + (r.id || '-') + '</span></td>' +
                    '<td><span style="font-weight:600;color:var(--text)">¥' + (r.amount || 0) + '</span></td>' +
                    '<td><span class="stat-pill" style="background:#f0fdf4;color:#16a34a">' + (r.quota_amount || 0) + ' 次</span></td>' +
                    '<td class="time-cell">' + formatTime(r.created_at) + '</td>' +
                '</tr>';
            }).join('');
            
            document.getElementById('rechargeTable').innerHTML = 
                '<table class="data-table">' +
                    '<thead><tr>' +
                        '<th>订单号</th><th>金额</th><th>额度</th><th>时间</th>' +
                    '</tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                '</table>';
        }
        
        // 渲染定时任务列表（显示所有创建的任务）
        function renderScheduledTasks(tasks) {
            // 注意：taskCount元素在新布局中已移除，不再需要更新
            
            if (!tasks.length) {
                document.getElementById('tasksTable').innerHTML = 
                    '<div class="empty-state"><div class="empty-icon">⏰</div><p class="empty-text">暂无定时任务</p></div>';
                return;
            }
            
            // 格式化调度描述（支持多个执行时间）
            function formatScheduleDesc(task) {
                // 获取执行时间列表（优先使用 executionTimes，否则使用 hour/minute）
                const executionTimes = task.executionTimes && task.executionTimes.length > 0
                    ? task.executionTimes
                    : [{ hour: task.hour, minute: task.minute }];
                
                // 格式化时间列表
                const timeStrs = executionTimes.map(t => 
                    String(t.hour).padStart(2, '0') + ':' + String(t.minute).padStart(2, '0')
                );
                
                if (task.scheduleType === 'daily') {
                    // 每天模式：显示所有时间点
                    return '每天 ' + timeStrs.join('、');
                }
                
                if (task.scheduleType === 'weekly') {
                    // 每周模式：显示周几和所有时间点
                    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                    const days = (task.weekdays || []).map(d => weekdayNames[d]).join('、');
                    return '每' + days + ' ' + timeStrs.join('、');
                }
                
                // 间隔模式：不使用时间点
                return '每 ' + (task.intervalMinutes || 60) + ' 分钟';
            }
            
            const rows = tasks.map(task => {
                // 状态显示
                const isEnabled = task.enabled !== false;
                const statusText = isEnabled ? '运行中' : '已停止';
                const statusColor = isEnabled ? '#10b981' : '#9ca3af';
                
                // 平台显示（转换平台代码为中文名称）
                const platformMap = {
                    'weixin': '公众号',
                    'toutiao': '头条号',
                    'zhihu': '知乎',
                    'xiaohongshu': '小红书'
                };
                const platformNames = task.platforms && task.platforms.length > 0 
                    ? task.platforms.map(p => platformMap[p] || p).join('、') 
                    : '全部';
                
                // 执行周期描述
                const scheduleDesc = formatScheduleDesc(task);
                
                // 文章数量
                const articleCount = task.articleCount || 1;
                
                // Node ID（不截取，使用等宽字体）
                const nodeId = task.tophubNodeId || '-';
                
                // 通知邮箱（不截取）
                const email = task.notificationEmail || '-';
                
                // 自定义提示词（截取前20个字符，鼠标悬停显示完整）
                const customPrompt = task.customPrompt || '-';
                const promptDisplay = customPrompt.length > 20 ? customPrompt.substring(0, 20) + '...' : customPrompt;
                
                // 上次执行时间和状态
                let lastRunText = '-';
                if (task.lastRunTime) {
                    const statusEmoji = task.lastRunStatus === 'success' ? '✅' : 
                                       task.lastRunStatus === 'failed' ? '❌' : '⏳';
                    lastRunText = formatTime(Math.floor(task.lastRunTime / 1000)) + ' ' + statusEmoji;
                }
                
                return '<tr>' +
                    '<td style="min-width:100px"><span style="font-weight:500;color:var(--text)">' + (task.name || '未命名任务') + '</span></td>' +
                    '<td style="min-width:70px"><span class="stat-pill" style="background:' + statusColor + '20;color:' + statusColor + '">' + statusText + '</span></td>' +
                    '<td style="min-width:90px"><span style="color:var(--text-secondary);font-size:0.85rem">' + platformNames + '</span></td>' +
                    '<td style="min-width:130px"><span style="color:var(--text-muted);font-size:0.85rem">' + scheduleDesc + '</span></td>' +
                    '<td style="min-width:70px;text-align:center"><span style="color:var(--text);font-size:0.85rem">' + articleCount + ' 篇</span></td>' +
                    '<td style="min-width:90px"><span style="color:var(--text-muted);font-size:0.85rem;font-family:monospace">' + nodeId + '</span></td>' +
                    '<td style="min-width:140px"><span style="color:var(--text-muted);font-size:0.85rem">' + email + '</span></td>' +
                    '<td style="width:150px;max-width:150px"><span style="color:var(--text-muted);font-size:0.85rem;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + customPrompt.replace(/"/g, '&quot;') + '">' + promptDisplay + '</span></td>' +
                    '<td style="min-width:140px" class="time-cell">' + lastRunText + '</td>' +
                    '<td style="min-width:70px"><button class="action-btn" onclick="viewTaskLogs(&quot;' + task.id + '&quot;, &quot;' + (task.name || '未命名任务').replace(/"/g, '&quot;') + '&quot;)" title="查看执行记录">📋 记录</button></td>' +
                '</tr>';
            }).join('');
            
            document.getElementById('tasksTable').innerHTML = 
                '<div style="overflow-x:auto"><table class="data-table" style="width:100%">' +
                    '<thead><tr>' +
                        '<th style="min-width:100px">任务名称</th>' +
                        '<th style="min-width:70px">状态</th>' +
                        '<th style="min-width:90px">目标平台</th>' +
                        '<th style="min-width:130px">执行周期</th>' +
                        '<th style="min-width:70px">文章数量</th>' +
                        '<th style="min-width:90px">Node ID</th>' +
                        '<th style="min-width:140px">通知邮箱</th>' +
                        '<th style="width:150px;max-width:150px">自定义提示词</th>' +
                        '<th style="min-width:140px">上次执行</th>' +
                        '<th style="min-width:70px">操作</th>' +
                    '</tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                '</table></div>';
        }
        
        // 执行记录分页变量
        let currentTaskId = '';
        let currentTaskName = '';
        let logsPage = 1;
        let logsPageSize = 10;
        let logsTotalCount = 0;
        
        // 查看任务执行记录
        async function viewTaskLogs(taskId, taskName) {
            // 保存当前任务信息，用于分页
            currentTaskId = taskId;
            currentTaskName = taskName;
            logsPage = 1; // 重置到第一页
            
            await loadTaskLogs();
        }
        
        // 加载任务执行记录（支持分页）
        async function loadTaskLogs() {
            try {
                const token = localStorage.getItem('memoraid_token');
                if (!token) return;
                
                const offset = (logsPage - 1) * logsPageSize;
                const headers = { 'Authorization': 'Bearer ' + token };
                const res = await fetch(API_BASE + '/api/task-execution-logs?task_id=' + encodeURIComponent(currentTaskId) + '&limit=' + logsPageSize + '&offset=' + offset, { headers });
                const data = await res.json();
                
                const logs = data.logs || [];
                logsTotalCount = data.total || 0;
                
                // 构建弹窗内容
                let modalContent = '<div style="padding:20px">';
                modalContent += '<h3 style="margin:0 0 16px;font-size:18px;color:var(--text)">📋 ' + currentTaskName + ' - 执行记录</h3>';
                
                if (logs.length === 0) {
                    modalContent += '<div class="empty-state"><div class="empty-icon">📝</div><p class="empty-text">暂无执行记录</p></div>';
                } else {
                    modalContent += '<div style="max-height:500px;overflow-y:auto">';
                    modalContent += '<table class="data-table" style="margin:0">';
                    modalContent += '<thead><tr><th>执行时间</th><th>状态</th><th>生成</th><th>发布</th><th>耗时</th></tr></thead>';
                    modalContent += '<tbody>';
                    
                    logs.forEach(log => {
                        const statusColor = log.status === 'success' ? '#10b981' : 
                                          log.status === 'failed' ? '#ef4444' : '#f59e0b';
                        const statusText = log.status === 'success' ? '✅ 成功' : 
                                         log.status === 'failed' ? '❌ 失败' : '⏳ 执行中';
                        const duration = log.duration ? Math.round(log.duration / 1000) + 's' : '-';
                        
                        modalContent += '<tr>';
                        modalContent += '<td class="time-cell">' + formatTime(Math.floor(log.started_at / 1000)) + '</td>';
                        modalContent += '<td><span class="stat-pill" style="background:' + statusColor + '20;color:' + statusColor + '">' + statusText + '</span></td>';
                        modalContent += '<td>' + (log.articles_generated || 0) + ' 篇</td>';
                        modalContent += '<td>' + (log.articles_published || 0) + ' 篇</td>';
                        modalContent += '<td>' + duration + '</td>';
                        modalContent += '</tr>';
                        
                        // 如果有错误信息，显示在下一行
                        if (log.error_message) {
                            modalContent += '<tr><td colspan="5" style="padding:8px 12px;background:#fef2f2;border-left:3px solid #ef4444">';
                            modalContent += '<span style="color:#dc2626;font-size:0.85rem">⚠️ ' + log.error_message + '</span>';
                            modalContent += '</td></tr>';
                        }
                    });
                    
                    modalContent += '</tbody></table></div>';
                    
                    // 添加分页组件
                    const totalPages = Math.ceil(logsTotalCount / logsPageSize);
                    if (totalPages > 1) {
                        modalContent += '<div style="margin-top:16px;display:flex;align-items:center;justify-content:center;gap:12px">';
                        modalContent += '<button class="pagination-btn" onclick="changeLogsPage(' + (logsPage - 1) + ')" ' + (logsPage === 1 ? 'disabled' : '') + '>上一页</button>';
                        modalContent += '<span class="pagination-info">第 ' + logsPage + ' / ' + totalPages + ' 页（共 ' + logsTotalCount + ' 条）</span>';
                        modalContent += '<button class="pagination-btn" onclick="changeLogsPage(' + (logsPage + 1) + ')" ' + (logsPage === totalPages ? 'disabled' : '') + '>下一页</button>';
                        modalContent += '</div>';
                    }
                }
                
                modalContent += '<div style="margin-top:20px;text-align:right">';
                modalContent += '<button class="btn-primary" onclick="closeModal()" style="padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer">关闭</button>';
                modalContent += '</div></div>';
                
                // 显示弹窗
                showModal(modalContent);
                
            } catch (e) {
                console.error('加载执行记录失败:', e);
                alert('加载执行记录失败，请稍后重试');
            }
        }
        
        // 切换执行记录页码
        function changeLogsPage(page) {
            const totalPages = Math.ceil(logsTotalCount / logsPageSize);
            if (page < 1 || page > totalPages) return;
            logsPage = page;
            loadTaskLogs();
        }
        
        // 显示模态框
        function showModal(content) {
            // 创建遮罩层
            let overlay = document.getElementById('modalOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'modalOverlay';
                overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
                overlay.onclick = function(e) {
                    if (e.target === overlay) closeModal();
                };
                document.body.appendChild(overlay);
            }
            
            // 创建弹窗
            const modal = document.createElement('div');
            modal.id = 'modalContent';
            modal.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:800px;width:90%;max-height:80vh;overflow:hidden';
            modal.innerHTML = content;
            
            overlay.innerHTML = '';
            overlay.appendChild(modal);
            overlay.style.display = 'flex';
        }
        
        // 关闭模态框
        function closeModal() {
            const overlay = document.getElementById('modalOverlay');
            if (overlay) {
                overlay.style.display = 'none';
            }
        }
        
        // 渲染文章分页
        function renderArticlesPagination() {
            const totalPages = Math.ceil(articlesTotalCount / articlesPageSize);
            if (totalPages <= 1) {
                document.getElementById('articlesPagination').innerHTML = '';
                return;
            }
            
            let html = '<button class="pagination-btn" onclick="changeArticlesPage(' + (articlesPage - 1) + ')" ' + (articlesPage === 1 ? 'disabled' : '') + '>上一页</button>';
            html += '<span class="pagination-info">第 ' + articlesPage + ' / ' + totalPages + ' 页</span>';
            html += '<button class="pagination-btn" onclick="changeArticlesPage(' + (articlesPage + 1) + ')" ' + (articlesPage === totalPages ? 'disabled' : '') + '>下一页</button>';
            
            document.getElementById('articlesPagination').innerHTML = html;
        }
        
        // 渲染充值记录分页
        function renderRechargePagination() {
            const totalPages = Math.ceil(rechargeTotalCount / rechargePageSize);
            if (totalPages <= 1) {
                document.getElementById('rechargePagination').innerHTML = '';
                return;
            }
            
            let html = '<button class="pagination-btn" onclick="changeRechargePage(' + (rechargePage - 1) + ')" ' + (rechargePage === 1 ? 'disabled' : '') + '>上一页</button>';
            html += '<span class="pagination-info">第 ' + rechargePage + ' / ' + totalPages + ' 页</span>';
            html += '<button class="pagination-btn" onclick="changeRechargePage(' + (rechargePage + 1) + ')" ' + (rechargePage === totalPages ? 'disabled' : '') + '>下一页</button>';
            
            document.getElementById('rechargePagination').innerHTML = html;
        }
        
        // 切换文章页码
        function changeArticlesPage(page) {
            const totalPages = Math.ceil(articlesTotalCount / articlesPageSize);
            if (page < 1 || page > totalPages) return;
            articlesPage = page;
            loadArticles();
        }
        
        // 切换充值记录页码
        function changeRechargePage(page) {
            const totalPages = Math.ceil(rechargeTotalCount / rechargePageSize);
            if (page < 1 || page > totalPages) return;
            rechargePage = page;
            loadRechargeHistory();
        }
        
        // 平台筛选（支持多选）
        function filterPlatform(platform) {
            if (platform === 'all') {
                // 点击"全部平台"，清空筛选
                currentPlatform = [];
            } else {
                // 切换平台选中状态
                const index = currentPlatform.indexOf(platform);
                if (index > -1) {
                    // 已选中，取消选中
                    currentPlatform.splice(index, 1);
                } else {
                    // 未选中，添加选中
                    currentPlatform.push(platform);
                }
            }
            articlesPage = 1; // 重置到第一页
            loadArticles();
            
            // 手动更新按钮状态（因为loadArticles是异步的）
            setTimeout(() => {
                const buttons = document.querySelectorAll('#platformFilters .filter-tag');
                buttons.forEach(btn => {
                    const btnText = btn.textContent.trim();
                    if (btnText === '全部平台') {
                        if (currentPlatform.length === 0) {
                            btn.classList.add('active');
                        } else {
                            btn.classList.remove('active');
                        }
                    } else {
                        // 检查按钮对应的平台是否在选中列表中
                        const isSelected = currentPlatform.some(p => btnText.includes(p) || btn.getAttribute('onclick').includes(p));
                        if (isSelected) {
                            btn.classList.add('active');
                        } else {
                            btn.classList.remove('active');
                        }
                    }
                });
            }, 100);
        }
        
        function openRechargeModal() {
            resetPayment();
            document.getElementById('rechargeModal').classList.add('active');
        }
        
        function closeRechargeModal() {
            document.getElementById('rechargeModal').classList.remove('active');
            resetPayment();
        }

        function resetPayment() {
            stopPaymentPolling();
            currentOrderId = null;
            currentPaymentQrcode = '';
            document.getElementById('payStep0').style.display = 'block';
            document.getElementById('payStep2').style.display = 'none';
            document.getElementById('payQrCode').src = '';
            document.getElementById('paymentStatusText').textContent = '系统会自动检查付款状态，请稍等...';
            document.getElementById('paymentStatusText').style.color = 'var(--text-secondary)';
            document.getElementById('checkPaymentBtn').disabled = false;
        }

        let currentOrderId = null;
        let currentPaymentQrcode = '';
        let paymentPollTimer = null;

        function selectPlan(amount, el) {
            selectedAmount = amount;
            document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('active'));
            el.classList.add('active');
        }

        function stopPaymentPolling() {
            if (paymentPollTimer) {
                clearInterval(paymentPollTimer);
                paymentPollTimer = null;
            }
        }

        function updatePaymentStatus(text, isSuccess) {
            const statusEl = document.getElementById('paymentStatusText');
            statusEl.textContent = text;
            statusEl.style.color = isSuccess ? '#059669' : 'var(--text-secondary)';
        }

        async function fetchPaymentStatus() {
            if (!currentOrderId) return null;

            const res = await fetch(API_BASE + '/api/payment/status?orderId=' + encodeURIComponent(currentOrderId));
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || '查询支付状态失败');
            }
            return data;
        }

        async function handlePaidOrder(data) {
            stopPaymentPolling();
            updatePaymentStatus('支付成功，额度已自动到账。', true);
            document.getElementById('checkPaymentBtn').disabled = true;
            await loadData();
            setTimeout(() => {
                closeRechargeModal();
            }, 1500);
        }

        function startPaymentPolling() {
            stopPaymentPolling();
            paymentPollTimer = setInterval(async () => {
                try {
                    const data = await fetchPaymentStatus();
                    if (data && data.isPaid) {
                        await handlePaidOrder(data);
                    }
                } catch (error) {
                    console.error('轮询支付状态失败:', error);
                }
            }, 3000);
        }

        function preloadPaymentQrcode(url) {
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(url);
                image.onerror = () => reject(new Error('支付二维码加载失败'));
                image.src = url;
            });
        }

        async function createOrder(btn) {
            const token = localStorage.getItem('memoraid_token');
            if (!token) {
                showLoginRequired();
                return;
            }

            try {
                btn.disabled = true;
                btn.style.opacity = '0.7';
                updatePaymentStatus('正在创建支付订单...', false);

                const res = await fetch(API_BASE + '/api/payment/create', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ amount: selectedAmount })
                });

                const data = await res.json();
                
                if (data.error) {
                    alert('创建订单失败: ' + data.error);
                    return;
                }

                currentOrderId = data.orderId;
                currentPaymentQrcode = data.paymentQrcode || data.paymentUrl || '';
                await preloadPaymentQrcode(currentPaymentQrcode);

                document.getElementById('payQrCode').src = currentPaymentQrcode;
                document.getElementById('payStep0').style.display = 'none';
                document.getElementById('payStep2').style.display = 'block';
                updatePaymentStatus('系统会自动检查付款状态，请稍等...', false);

                startPaymentPolling();
            } catch (e) {
                console.error('创建订单错误:', e);
                alert('网络错误，请稍后重试');
            } finally {
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }

        async function checkPaymentStatus(btn) {
            if (!currentOrderId) {
                alert('订单号未找到，请刷新重试');
                return;
            }

            const originalText = btn.textContent;
            btn.textContent = '检查中...';
            btn.disabled = true;
            btn.style.opacity = '0.7';
            
            try {
                const data = await fetchPaymentStatus();
                if (data && data.isPaid) {
                    await handlePaidOrder(data);
                } else {
                    updatePaymentStatus('系统暂未检测到付款成功，正在继续自动检查，请稍等...', false);
                }
            } catch (e) {
                console.error('检查支付状态失败:', e);
                alert('检查失败: ' + e.message);
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }

        // ========== 工单相关函数 ==========
        
        // 显示创建工单弹窗
        function showCreateTicketModal() {
            document.getElementById('ticketSubject').value = '';
            document.getElementById('ticketMessage').value = '';
            document.getElementById('createTicketModal').classList.add('active');
        }
        
        // 关闭创建工单弹窗
        function closeCreateTicketModal() {
            document.getElementById('createTicketModal').classList.remove('active');
        }
        
        // 提交工单
        async function submitTicket() {
            const subject = document.getElementById('ticketSubject').value.trim();
            const message = document.getElementById('ticketMessage').value.trim();
            
            if (!subject) {
                alert('请输入工单主题');
                return;
            }
            
            if (!message) {
                alert('请输入详细描述');
                return;
            }
            
            try {
                const token = localStorage.getItem('memoraid_token');
                const res = await fetch(API_BASE + '/api/tickets', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ subject, message })
                });
                
                const data = await res.json();
                
                if (!res.ok) {
                    throw new Error(data.error || '创建工单失败');
                }
                
                alert('工单创建成功！');
                closeCreateTicketModal();
                loadTickets(); // 重新加载工单列表
            } catch (e) {
                console.error('创建工单失败:', e);
                alert('创建工单失败: ' + e.message);
            }
        }
        
        // 加载工单列表
        async function loadTickets() {
            const token = localStorage.getItem('memoraid_token');
            if (!token) return;
            
            try {
                const res = await fetch(API_BASE + '/api/tickets', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await res.json();
                
                if (!res.ok) {
                    throw new Error(data.error || '加载工单列表失败');
                }
                
                const tickets = data.tickets || [];
                const container = document.getElementById('ticketsTable');
                
                if (tickets.length === 0) {
                    container.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><p class="empty-text">暂无工单记录</p><p class="empty-hint">点击上方按钮创建新工单</p></div>';
                    return;
                }
                
                let html = '<table class="data-table"><thead><tr><th>工单编号</th><th>主题</th><th>状态</th><th>消息数</th><th>创建时间</th><th>操作</th></tr></thead><tbody>';
                
                tickets.forEach(ticket => {
                    const statusMap = {
                        'open': { text: '待处理', color: '#f59e0b' },
                        'replied': { text: '已回复', color: '#10b981' },
                        'closed': { text: '已关闭', color: '#6b7280' }
                    };
                    const status = statusMap[ticket.status] || statusMap['open'];
                    const hasNewReply = ticket.admin_reply_count > 0 && ticket.status === 'replied';
                    
                    html += '<tr>';
                    html += '<td>#' + ticket.id + '</td>';
                    html += '<td>' + ticket.subject + (hasNewReply ? ' <span style="color:#10b981;font-weight:600">●</span>' : '') + '</td>';
                    html += '<td><span class="stat-pill" style="background:' + status.color + '20;color:' + status.color + '">' + status.text + '</span></td>';
                    html += '<td>' + ticket.message_count + ' 条</td>';
                    html += '<td class="time-cell">' + formatTime(Math.floor(new Date(ticket.created_at).getTime() / 1000)) + '</td>';
                    html += '<td><button class="btn btn-sm btn-ghost" onclick="viewTicketDetail(' + ticket.id + ')">查看详情</button></td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table>';
                container.innerHTML = html;
            } catch (e) {
                console.error('加载工单列表失败:', e);
                document.getElementById('ticketsTable').innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p class="empty-text">加载失败: ' + e.message + '</p></div>';
            }
        }
        
        let currentTicketId = null;
        
        // 查看工单详情
        async function viewTicketDetail(ticketId) {
            currentTicketId = ticketId;
            document.getElementById('ticketDetailModal').classList.add('active');
            document.getElementById('ticketReplyMessage').value = '';
            
            const container = document.getElementById('ticketDetailContent');
            container.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">加载中...</div></div>';
            
            try {
                const token = localStorage.getItem('memoraid_token');
                const res = await fetch(API_BASE + '/api/tickets/' + ticketId, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                const data = await res.json();
                
                if (!res.ok) {
                    throw new Error(data.error || '加载工单详情失败');
                }
                
                const ticket = data.ticket;
                const messages = data.messages || [];
                
                const statusMap = {
                    'open': { text: '待处理', color: '#f59e0b' },
                    'replied': { text: '已回复', color: '#10b981' },
                    'closed': { text: '已关闭', color: '#6b7280' }
                };
                const status = statusMap[ticket.status] || statusMap['open'];
                
                let html = '<div style="margin-bottom: 20px; padding: 16px; background: #f8fafc; border-radius: 12px;">';
                html += '<div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">';
                html += '<h3 style="margin: 0; font-size: 18px; color: #0f172a;">工单 #' + ticket.id + ': ' + ticket.subject + '</h3>';
                html += '<span class="stat-pill" style="background:' + status.color + '20;color:' + status.color + '">' + status.text + '</span>';
                html += '</div>';
                html += '<div style="font-size: 14px; color: #9ca3af;">创建时间: ' + formatTime(Math.floor(new Date(ticket.created_at).getTime() / 1000)) + '</div>';
                html += '</div>';
                
                html += '<div style="max-height: 400px; overflow-y: auto;">';
                messages.forEach(msg => {
                    const isAdmin = msg.is_admin === 1;
                    const bgColor = isAdmin ? '#e0f2fe' : '#f3f4f6';
                    const align = isAdmin ? 'left' : 'right';
                    const label = isAdmin ? '客服回复' : '我';
                    const labelColor = isAdmin ? '#0284c7' : '#6b7280';
                    
                    html += '<div style="margin-bottom: 16px; text-align: ' + align + ';">';
                    html += '<div style="display: inline-block; max-width: 80%; text-align: left;">';
                    html += '<div style="font-size: 12px; color: ' + labelColor + '; margin-bottom: 4px; font-weight: 600;">' + label + '</div>';
                    html += '<div style="padding: 12px; background: ' + bgColor + '; border-radius: 12px; word-wrap: break-word;">';
                    html += msg.message.replace(/\\n/g, '<br>');
                    html += '</div>';
                    html += '<div style="font-size: 11px; color: #9ca3af; margin-top: 4px;">' + formatTime(Math.floor(new Date(msg.created_at).getTime() / 1000)) + '</div>';
                    html += '</div></div>';
                });
                html += '</div>';
                
                container.innerHTML = html;
            } catch (e) {
                console.error('加载工单详情失败:', e);
                container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p class="empty-text">加载失败: ' + e.message + '</p></div>';
            }
        }
        
        // 关闭工单详情弹窗
        function closeTicketDetailModal() {
            document.getElementById('ticketDetailModal').classList.remove('active');
            currentTicketId = null;
        }
        
        // 提交工单回复
        async function submitTicketReply() {
            if (!currentTicketId) {
                alert('工单ID未找到');
                return;
            }
            
            const message = document.getElementById('ticketReplyMessage').value.trim();
            
            if (!message) {
                alert('请输入回复内容');
                return;
            }
            
            try {
                const token = localStorage.getItem('memoraid_token');
                const res = await fetch(API_BASE + '/api/tickets/' + currentTicketId + '/messages', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message })
                });
                
                const data = await res.json();
                
                if (!res.ok) {
                    throw new Error(data.error || '发送回复失败');
                }
                
                document.getElementById('ticketReplyMessage').value = '';
                viewTicketDetail(currentTicketId); // 重新加载工单详情
            } catch (e) {
                console.error('发送回复失败:', e);
                alert('发送回复失败: ' + e.message);
            }
        }

        // 初始化：先检查登录，再加载数据
        async function init() {
            const isAuth = await checkAuth();
            if (isAuth) {
                // 根据URL hash决定显示哪个Tab（默认为articles）
                const hash = window.location.hash.slice(1) || 'articles';
                switchTab(hash);
                
                // 如果是文章列表Tab，立即显示平台筛选区域（显示加载状态）
                if (hash === 'articles') {
                    document.getElementById('platformFilterBar').style.display = 'block';
                }
                
                loadData();
            }
        }
        
        // 监听hash变化，实现前端路由
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.slice(1) || 'articles';
            switchTab(hash);
        });
        
        init();
    </script>
</body>
</html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
    }

    // 7.2 GET /api/platforms - 获取平台列表
    if (url.pathname === '/api/platforms' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        let platforms;

        if (userId) {
          // 用户页只展示当前用户实际有文章的平台，并排除测试平台。
          platforms = await env.DB.prepare(`
            SELECT DISTINCT p.id, p.name, p.display_name, p.icon
            FROM platforms p
            JOIN accounts a ON a.platform_id = p.id
            JOIN articles art ON art.account_id = a.id
            WHERE a.user_id = ? AND p.name != 'test'
            ORDER BY p.id
          `).bind(userId).all();
        } else {
          platforms = await env.DB.prepare(
            "SELECT id, name, display_name, icon FROM platforms WHERE name != 'test' ORDER BY id"
          ).all();
        }

        return new Response(JSON.stringify({ platforms: platforms.results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 7.3 GET /api/accounts - 获取账号列表（含统计）
    if (url.pathname === '/api/accounts' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const platform = url.searchParams.get('platform');
        let query = `
          SELECT a.*, p.name as platform_name, p.display_name as platform_display_name, p.icon as platform_icon,
            (SELECT COUNT(*) FROM articles WHERE account_id = a.id) as article_count,
            (SELECT COALESCE(SUM(s.read_count), 0) FROM articles art 
             LEFT JOIN article_stats s ON s.id = (SELECT MAX(id) FROM article_stats WHERE article_id = art.id)
             WHERE art.account_id = a.id) as total_reads,
            (SELECT COALESCE(SUM(s.like_count), 0) FROM articles art 
             LEFT JOIN article_stats s ON s.id = (SELECT MAX(id) FROM article_stats WHERE article_id = art.id)
             WHERE art.account_id = a.id) as total_likes
          FROM accounts a
          JOIN platforms p ON a.platform_id = p.id
          WHERE a.user_id = '${userId}'
        `;
        if (platform) query += ` AND p.name = '${platform}'`;
        query += ' ORDER BY a.updated_at DESC';
        
        const accounts = await env.DB.prepare(query).all();
        return new Response(JSON.stringify({ accounts: accounts.results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 7.4 GET /api/articles - 获取文章列表（含最新统计）
    if (url.pathname === '/api/articles' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const platform = url.searchParams.get('platform');
        const accountId = url.searchParams.get('account_id');
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        
        let query = `
          SELECT art.*, acc.account_name, p.name as platform_name, p.display_name as platform_display_name, p.icon as platform_icon,
            COALESCE(s.read_count, 0) as read_count,
            COALESCE(s.like_count, 0) as like_count,
            COALESCE(s.comment_count, 0) as comment_count,
            COALESCE(s.share_count, 0) as share_count,
            COALESCE(s.collect_count, 0) as collect_count,
            COALESCE(s.forward_count, 0) as forward_count
          FROM articles art
          JOIN accounts acc ON art.account_id = acc.id
          JOIN platforms p ON acc.platform_id = p.id
          LEFT JOIN article_stats s ON s.id = (SELECT MAX(id) FROM article_stats WHERE article_id = art.id)
          WHERE acc.user_id = '${userId}'
        `;
        if (platform) query += ` AND p.name = '${platform}'`;
        if (accountId) query += ` AND art.account_id = ${accountId}`;
        query += ` ORDER BY art.publish_time DESC LIMIT ${limit} OFFSET ${offset}`;
        
        const articles = await env.DB.prepare(query).all();
        return new Response(JSON.stringify({ articles: articles.results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 7.5 GET /api/articles/stats - 获取总体统计
    if (url.pathname === '/api/articles/stats' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const platform = url.searchParams.get('platform');
        let whereClause = `WHERE acc.user_id = '${userId}'`;
        if (platform) {
          whereClause += ` AND p.name = '${platform}'`;
        }
        
        const stats = await env.DB.prepare(`
          SELECT 
            COUNT(DISTINCT art.id) as totalArticles,
            COALESCE(SUM(s.read_count), 0) as totalReads,
            COALESCE(SUM(s.like_count), 0) as totalLikes,
            COALESCE(SUM(s.comment_count), 0) as totalComments,
            COALESCE(SUM(s.share_count), 0) as totalShares,
            COALESCE(SUM(s.collect_count), 0) as totalCollects
          FROM articles art
          JOIN accounts acc ON art.account_id = acc.id
          JOIN platforms p ON acc.platform_id = p.id
          LEFT JOIN article_stats s ON s.id = (SELECT MAX(id) FROM article_stats WHERE article_id = art.id)
          ${whereClause}
        `).first();
        
        return new Response(JSON.stringify(stats || {}), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 7.6 GET /api/user/quota - 获取用户额度
    if (url.pathname === '/api/user/quota' && request.method === 'GET') {
      try {
        // 优先从 Authorization 获取用户ID，如果没有则从 X-Anonymous-ID 获取
        let userId = getUserIdFromRequest(request);
        if (!userId) {
          // 尝试从匿名ID获取
          const anonymousId = request.headers.get('X-Anonymous-ID');
          if (anonymousId) {
            userId = anonymousId;
          }
        }
        
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 获取用户信息
        const user = await env.DB.prepare('SELECT provider FROM users WHERE id = ?').bind(userId).first();
        const isAnonymous = user?.provider === 'anonymous' || !user;
        const freeLimit = isAnonymous ? 5 : 20;
        
        // 获取已使用的免费次数（统计所有AI使用）
        // 容错处理：如果表不存在，返回0
        let usageCount = 0;
        try {
          usageCount = await env.DB.prepare(
            'SELECT COUNT(*) as count FROM ai_usage_logs WHERE user_id = ?'
          ).bind(userId).first('count') as number || 0;
        } catch (e) {
          console.error('ai_usage_logs表查询失败:', e);
          usageCount = 0;
        }
        
        // 获取付费额度
        // 容错处理：如果表不存在，返回默认值
        let quota = null;
        try {
          quota = await env.DB.prepare('SELECT * FROM user_quotas WHERE user_id = ?').bind(userId).first();
          
          if (!quota) {
            // 尝试初始化额度
            try {
              await env.DB.prepare('INSERT OR IGNORE INTO user_quotas (user_id) VALUES (?)').bind(userId).run();
              quota = await env.DB.prepare('SELECT * FROM user_quotas WHERE user_id = ?').bind(userId).first();
            } catch (insertError) {
              console.error('初始化user_quotas失败:', insertError);
            }
          }
        } catch (e) {
          console.error('user_quotas表查询失败:', e);
          // 表不存在时返回默认值
          quota = null;
        }
        
        const paidQuota = quota?.paid_quota_remaining || 0;
        const freeRemaining = Math.max(0, freeLimit - usageCount);
        const totalRemaining = freeRemaining + paidQuota;

        return new Response(JSON.stringify({
          ...quota,
          free_limit: freeLimit,
          free_used: usageCount,
          free_remaining: freeRemaining,
          paid_remaining: paidQuota,
          total_remaining: totalRemaining,
          is_anonymous: isAnonymous
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        console.error('获取用户额度失败:', e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 7.7 POST /api/payment/create - 创建支付订单
    if (url.pathname === '/api/payment/create' && request.method === 'POST') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const xunhupayConfig = getXunhupayConfig(env);
        if (!xunhupayConfig) {
          return new Response(JSON.stringify({ error: '虎皮椒支付尚未配置，请先设置 XUNHUPAY_APP_ID 和 XUNHUPAY_APP_SECRET' }), {
            status: 503,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const body = await request.json() as any;
        const amount = Number(body.amount || 10);
        if (![10, 30, 50].includes(amount)) {
          return new Response(JSON.stringify({ error: '仅支持 10 / 30 / 50 元套餐' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const orderId = crypto.randomUUID().replace(/-/g, '');
        let quota = 50;
        if (amount === 30) quota = 150;
        if (amount === 50) quota = 250;

        const totalFee = amount.toFixed(2);
        const nonceStr = crypto.randomUUID().replace(/-/g, '');
        const title = 'Memoraid付费额度充值';
        const time = Math.floor(Date.now() / 1000);
        const notifyUrl = `${effectiveOrigin}/api/payment/callback/xunhupay`;
        const returnUrl = `${effectiveOrigin}/payment/return?orderId=${orderId}`;
        const requestPayload: Record<string, string | number> = {
          version: '1.1',
          appid: xunhupayConfig.appId,
          trade_order_id: orderId,
          total_fee: totalFee,
          title,
          time,
          notify_url: notifyUrl,
          return_url: returnUrl,
          callback_url: `${effectiveOrigin}/user`,
          nonce_str: nonceStr,
        };
        const hash = buildXunhupayHash(requestPayload, xunhupayConfig.appSecret);

        await env.DB.prepare(
          'INSERT INTO payment_orders (id, user_id, amount, quota_amount, status, payment_url) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(orderId, userId, amount, quota, 'pending', '').run();

        const xunhupayResponse = await fetch(xunhupayConfig.gatewayUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            ...Object.fromEntries(Object.entries(requestPayload).map(([key, value]) => [key, String(value)])),
            hash,
          }).toString(),
        });

        const responseText = await xunhupayResponse.text();
        let responseData: Record<string, any>;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          console.error('虎皮椒支付返回非JSON:', responseText);
          return new Response(JSON.stringify({ error: '支付平台返回异常，请稍后重试' }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const responseHash = responseData.hash;
        if (!responseHash || responseHash !== buildXunhupayHash(responseData, xunhupayConfig.appSecret)) {
          console.error('虎皮椒响应验签失败:', responseData);
          return new Response(JSON.stringify({ error: '支付平台响应验签失败' }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (!xunhupayResponse.ok || Number(responseData.errcode) !== 0) {
          console.error('虎皮椒下单失败:', responseData);
          return new Response(JSON.stringify({ error: responseData.errmsg || '创建支付订单失败' }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const paymentUrl = String(responseData.url || '');
        const paymentQrcode = String(responseData.url_qrcode || paymentUrl || '');
        await env.DB.prepare('UPDATE payment_orders SET payment_url = ? WHERE id = ?')
          .bind(paymentUrl, orderId)
          .run();

        return new Response(JSON.stringify({ orderId, amount, quota, paymentUrl, paymentQrcode, provider: 'xunhupay' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // 7.8 POST /api/articles/report - 上报文章数据（供插件调用）
    if (url.pathname === '/api/articles/report' && request.method === 'POST') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const body = await request.json() as any;
        const { platform, account, articles } = body;
        
        if (!platform || !account || !articles) {
          return new Response(JSON.stringify({ error: '缺少必要参数' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 获取或创建平台
        let platformRow = await env.DB.prepare(
          'SELECT id FROM platforms WHERE name = ?'
        ).bind(platform).first();
        
        if (!platformRow) {
          await env.DB.prepare(
            'INSERT INTO platforms (name, display_name, icon) VALUES (?, ?, ?)'
          ).bind(platform, platform, '📄').run();
          platformRow = await env.DB.prepare('SELECT id FROM platforms WHERE name = ?').bind(platform).first();
        }
        
        // 获取或创建账号
        let accountRow = await env.DB.prepare(
          'SELECT id, user_id FROM accounts WHERE platform_id = ? AND account_id = ?'
        ).bind(platformRow!.id, account.id).first();
        
        if (!accountRow) {
          // 使用 INSERT OR IGNORE 避免并发插入冲突
          await env.DB.prepare(
            'INSERT OR IGNORE INTO accounts (platform_id, account_id, account_name, avatar_url, extra_info, user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(platformRow!.id, account.id, account.name || '', account.avatar || '', JSON.stringify(account.extra || {}), userId, Math.floor(Date.now() / 1000)).run();
          // 再次查询以获取 ID（可能是刚插入的，也可能是其他请求插入的）
          accountRow = await env.DB.prepare('SELECT id, user_id FROM accounts WHERE platform_id = ? AND account_id = ?').bind(platformRow!.id, account.id).first();
        }
        
        // 始终更新账号信息和 user_id，确保数据归属正确
        if (accountRow) {
          await env.DB.prepare(
            'UPDATE accounts SET user_id = ?, account_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?'
          ).bind(userId, account.name || '', account.avatar || '', Math.floor(Date.now() / 1000), accountRow.id).run();
        }
        
        // 批量处理文章
        let inserted = 0, updated = 0;
        for (const art of articles) {
          // 获取或创建文章
          let articleRow = await env.DB.prepare(
            'SELECT id FROM articles WHERE account_id = ? AND article_id = ?'
          ).bind(accountRow!.id, art.id).first();
          
          if (!articleRow) {
            await env.DB.prepare(
              'INSERT INTO articles (account_id, article_id, title, content_summary, cover_image, article_url, publish_time, status, extra_info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(accountRow!.id, art.id, art.title || '', art.summary || '', art.cover || '', art.url || '', art.publishTime || Math.floor(Date.now() / 1000), art.status || 'published', JSON.stringify(art.extra || {})).run();
            articleRow = await env.DB.prepare('SELECT id FROM articles WHERE account_id = ? AND article_id = ?').bind(accountRow!.id, art.id).first();
            inserted++;
          } else {
            // 更新文章信息
            await env.DB.prepare(
              'UPDATE articles SET title = ?, content_summary = ?, cover_image = ?, article_url = ?, publish_time = ?, status = ?, extra_info = ?, updated_at = ? WHERE id = ?'
            ).bind(
              art.title || '',
              art.summary || '',
              art.cover || '',
              art.url || '',
              art.publishTime || Math.floor(Date.now() / 1000),
              art.status || 'published',
              JSON.stringify(art.extra || {}),
              Math.floor(Date.now() / 1000),
              articleRow.id
            ).run();
            updated++;
          }
          
          // 插入统计数据
          if (art.stats) {
            await env.DB.prepare(
              'INSERT INTO article_stats (article_id, read_count, like_count, comment_count, share_count, collect_count, forward_count, extra_stats) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(articleRow!.id, art.stats.read || 0, art.stats.like || 0, art.stats.comment || 0, art.stats.share || 0, art.stats.collect || 0, art.stats.forward || 0, JSON.stringify(art.stats.extra || {})).run();
          }
        }
        
        return new Response(JSON.stringify({ success: true, inserted, updated }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ============================================
    // 定时任务 API - 用于管理用户的定时发布任务
    // ============================================

    // 8.1 GET /api/scheduled-tasks - 获取用户的所有定时任务
    if (url.pathname === '/api/scheduled-tasks' && request.method === 'GET') {
      try {
        // 支持匿名用户：优先使用 Authorization，否则使用 X-Anonymous-ID
        let userId = getUserIdFromRequest(request);
        if (!userId) {
          const anonymousId = request.headers.get('X-Anonymous-ID');
          if (anonymousId) {
            userId = anonymousId;
          }
        }
        
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        const tasks = await env.DB.prepare(
          'SELECT * FROM scheduled_tasks WHERE user_id = ? ORDER BY created_at DESC'
        ).bind(userId).all();

        // 将数据库字段转换为前端需要的格式（添加 articleCount、customPrompt、executionTimes 和 notificationEmail）
        const formattedTasks = tasks.results.map((task: any) => ({
          id: task.id,
          enabled: task.enabled === 1,
          name: task.name,
          scheduleType: task.schedule_type,
          hour: task.hour,
          minute: task.minute,
          executionTimes: task.execution_times ? JSON.parse(task.execution_times) : undefined, // 多个执行时间点
          weekdays: task.weekdays ? JSON.parse(task.weekdays) : undefined,
          intervalMinutes: task.interval_minutes,
          newsSourceType: task.news_source_type,
          newsSourceUrl: task.news_source_url,
          tophubNodeId: task.tophub_node_id,
          categories: JSON.parse(task.categories),
          platforms: JSON.parse(task.platforms),
          articleCount: task.article_count || 1, // 单次生成文章数量
          customPrompt: task.custom_prompt || '', // 自定义提示词
          notificationEmail: task.notification_email || '', // 通知邮箱
          lastRunTime: task.last_run_time,
          lastRunStatus: task.last_run_status,
          lastRunError: task.last_run_error,
          createdAt: task.created_at,
        }));

        return new Response(JSON.stringify({ tasks: formattedTasks }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 8.2 POST /api/scheduled-tasks - 创建新的定时任务
    if (url.pathname === '/api/scheduled-tasks' && request.method === 'POST') {
      try {
        // 支持匿名用户：优先使用 Authorization，否则使用 X-Anonymous-ID
        let userId = getUserIdFromRequest(request);
        if (!userId) {
          const anonymousId = request.headers.get('X-Anonymous-ID');
          if (anonymousId) {
            userId = anonymousId;
          }
        }
        
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        const body = await request.json() as any;
        const now = Date.now();

        // 插入新任务（添加 article_count、custom_prompt、execution_times 和 notification_email 字段）
        await env.DB.prepare(
          `INSERT INTO scheduled_tasks (
            id, user_id, enabled, name, schedule_type, hour, minute, 
            weekdays, interval_minutes, news_source_type, news_source_url, 
            tophub_node_id, categories, platforms, article_count, custom_prompt,
            execution_times, notification_email, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          body.id,
          userId,
          body.enabled ? 1 : 0,
          body.name,
          body.scheduleType,
          body.hour,
          body.minute,
          body.weekdays ? JSON.stringify(body.weekdays) : null,
          body.intervalMinutes || null,
          body.newsSourceType,
          body.newsSourceUrl,
          body.tophubNodeId || null,
          JSON.stringify(body.categories),
          JSON.stringify(body.platforms),
          body.articleCount || 1, // 默认 1 篇
          body.customPrompt || null, // 自定义提示词
          body.executionTimes ? JSON.stringify(body.executionTimes) : null, // 多个执行时间点
          body.notificationEmail || null, // 通知邮箱
          now,
          now
        ).run();

        return new Response(JSON.stringify({ success: true, id: body.id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 8.3 PUT /api/scheduled-tasks/:id - 更新指定的定时任务
    if (url.pathname.startsWith('/api/scheduled-tasks/') && request.method === 'PUT') {
      try {
        // 支持匿名用户：优先使用 Authorization，否则使用 X-Anonymous-ID
        let userId = getUserIdFromRequest(request);
        if (!userId) {
          const anonymousId = request.headers.get('X-Anonymous-ID');
          if (anonymousId) {
            userId = anonymousId;
          }
        }
        
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        const taskId = url.pathname.split('/').pop();
        const body = await request.json() as any;

        // 验证任务归属
        const task = await env.DB.prepare(
          'SELECT user_id FROM scheduled_tasks WHERE id = ?'
        ).bind(taskId).first();

        if (!task) {
          return new Response(JSON.stringify({ error: '任务不存在' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (task.user_id !== userId) {
          return new Response(JSON.stringify({ error: '无权限修改此任务' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 更新任务（只更新配置字段，不更新执行状态字段，添加 article_count、custom_prompt 和 notification_email）
        await env.DB.prepare(
          `UPDATE scheduled_tasks SET 
            enabled = ?, name = ?, schedule_type = ?, hour = ?, minute = ?,
            weekdays = ?, interval_minutes = ?, news_source_type = ?, 
            news_source_url = ?, tophub_node_id = ?, categories = ?, 
            platforms = ?, article_count = ?, custom_prompt = ?, execution_times = ?, 
            notification_email = ?, updated_at = ?
          WHERE id = ?`
        ).bind(
          body.enabled ? 1 : 0,
          body.name,
          body.scheduleType,
          body.hour,
          body.minute,
          body.weekdays ? JSON.stringify(body.weekdays) : null,
          body.intervalMinutes || null,
          body.newsSourceType,
          body.newsSourceUrl,
          body.tophubNodeId || null,
          JSON.stringify(body.categories),
          JSON.stringify(body.platforms),
          body.articleCount || 1, // 默认 1 篇
          body.customPrompt || null, // 自定义提示词
          body.executionTimes ? JSON.stringify(body.executionTimes) : null, // 多个执行时间点
          body.notificationEmail || null, // 通知邮箱
          Date.now(),
          taskId
        ).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 8.4 DELETE /api/scheduled-tasks/:id - 删除指定的定时任务
    if (url.pathname.startsWith('/api/scheduled-tasks/') && request.method === 'DELETE') {
      try {
        // 支持匿名用户：优先使用 Authorization，否则使用 X-Anonymous-ID
        let userId = getUserIdFromRequest(request);
        if (!userId) {
          const anonymousId = request.headers.get('X-Anonymous-ID');
          if (anonymousId) {
            userId = anonymousId;
          }
        }
        
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        const taskId = url.pathname.split('/').pop();

        // 验证任务归属
        const task = await env.DB.prepare(
          'SELECT user_id FROM scheduled_tasks WHERE id = ?'
        ).bind(taskId).first();

        if (!task) {
          return new Response(JSON.stringify({ error: '任务不存在' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (task.user_id !== userId) {
          return new Response(JSON.stringify({ error: '无权限删除此任务' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 删除任务
        await env.DB.prepare(
          'DELETE FROM scheduled_tasks WHERE id = ?'
        ).bind(taskId).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 8.5 PATCH /api/scheduled-tasks/:id/status - 更新任务执行状态（供调度器调用）
    if (url.pathname.match(/^\/api\/scheduled-tasks\/[^/]+\/status$/) && request.method === 'PATCH') {
      try {
        const taskId = url.pathname.split('/')[3];
        const body = await request.json() as any;

        // 只更新执行状态字段
        await env.DB.prepare(
          `UPDATE scheduled_tasks SET 
            last_run_time = ?, last_run_status = ?, last_run_error = ?
          WHERE id = ?`
        ).bind(
          body.lastRunTime || null,
          body.lastRunStatus || null,
          body.lastRunError || null,
          taskId
        ).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 8.5.1 POST /api/task-execution-logs - 创建任务执行记录（供调度器调用）
    if (url.pathname === '/api/task-execution-logs' && request.method === 'POST') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const body = await request.json() as {
          task_id: string;
          task_name: string;
          status: 'running' | 'success' | 'failed';
          started_at: number;
        };

        // 插入执行记录
        const result = await env.DB.prepare(
          `INSERT INTO task_execution_logs (task_id, user_id, task_name, status, started_at)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          body.task_id,
          userId,
          body.task_name,
          body.status,
          body.started_at
        ).run();

        // 返回新创建的记录ID
        return new Response(JSON.stringify({ 
          success: true, 
          id: result.meta.last_row_id 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 8.5.2 PATCH /api/task-execution-logs/:id - 更新任务执行记录（供调度器调用）
    if (url.pathname.match(/^\/api\/task-execution-logs\/\d+$/) && request.method === 'PATCH') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const logId = url.pathname.split('/')[3];
        const body = await request.json() as {
          status?: 'running' | 'success' | 'failed';
          completed_at?: number;
          duration?: number;
          articles_generated?: number;
          articles_published?: number;
          error_message?: string;
        };

        // 构建更新语句
        const updates: string[] = [];
        const params: any[] = [];

        if (body.status !== undefined) {
          updates.push('status = ?');
          params.push(body.status);
        }
        if (body.completed_at !== undefined) {
          updates.push('completed_at = ?');
          params.push(body.completed_at);
        }
        if (body.duration !== undefined) {
          updates.push('duration = ?');
          params.push(body.duration);
        }
        if (body.articles_generated !== undefined) {
          updates.push('articles_generated = ?');
          params.push(body.articles_generated);
        }
        if (body.articles_published !== undefined) {
          updates.push('articles_published = ?');
          params.push(body.articles_published);
        }
        if (body.error_message !== undefined) {
          updates.push('error_message = ?');
          params.push(body.error_message);
        }

        if (updates.length === 0) {
          return new Response(JSON.stringify({ error: 'No fields to update' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 添加WHERE条件参数
        params.push(logId);
        params.push(userId);

        // 执行更新（只能更新自己的记录）
        await env.DB.prepare(
          `UPDATE task_execution_logs SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
        ).bind(...params).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 8.6 POST /api/scheduled-tasks/send-notification - 发送任务完成通知邮件
    if (url.pathname === '/api/scheduled-tasks/send-notification' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          taskName: string;
          taskId: string;
          executionTime: string;
          status: 'success' | 'failed';
          successCount: number;
          failedCount: number;
          totalCount: number;
          articles: Array<{
            title: string;
            sourceUrl: string;
            platforms: string[];
            status: 'success' | 'failed';
            publishTime: string;
            errorMessage?: string;
          }>;
          logs: Array<{
            time: string;
            level: 'info' | 'success' | 'error' | 'warn';
            message: string;
          }>;
          notificationEmail: string;
        };

        // 验证邮箱地址
        if (!body.notificationEmail || !body.notificationEmail.includes('@')) {
          return new Response(JSON.stringify({ error: '无效的邮箱地址' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 生成文章详情 HTML
        const articlesHtml = body.articles.map((article, index) => {
          const statusClass = article.status === 'success' ? 'status-success' : 'status-failed';
          const statusIcon = article.status === 'success' ? '✅' : '❌';
          const statusText = article.status === 'success' ? '发布成功' : '发布失败';
          const cardClass = article.status === 'success' ? 'article-card' : 'article-card failed';
          
          const platformTags = article.platforms.map(p => 
            `<span class="platform-tag">${p}</span>`
          ).join('');

          let errorHtml = '';
          if (article.status === 'failed' && article.errorMessage) {
            errorHtml = `<div class="article-info" style="color: #f44336;">失败原因：${article.errorMessage}</div>`;
          }

          return `
            <div class="${cardClass}">
              <div class="article-title">${statusIcon} 文章 ${index + 1}</div>
              <div class="article-info"><strong>状态：</strong><span class="${statusClass}">${statusText}</span></div>
              <div class="article-info"><strong>标题：</strong>${article.title}</div>
              <div class="article-info"><strong>素材来源：</strong><a href="${article.sourceUrl}" style="color: #1976d2;">${article.sourceUrl}</a></div>
              <div class="article-info"><strong>发布时间：</strong>${article.publishTime}</div>
              ${errorHtml}
              <div class="article-platforms">${platformTags}</div>
            </div>
          `;
        }).join('');

        // 生成日志 HTML
        const logsHtml = body.logs.map(log => {
          const icon = log.level === 'success' ? '✅' : 
                      log.level === 'error' ? '❌' : 
                      log.level === 'warn' ? '⚠️' : 'ℹ️';
          return `<div class="log-entry"><span class="log-time">[${log.time}]</span> ${icon} ${log.message}</div>`;
        }).join('');

        // 读取邮件模板
        const emailTemplate = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Memoraid 定时任务执行报告</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: #ffffff;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            padding-bottom: 20px;
            border-bottom: 2px solid #4CAF50;
            margin-bottom: 30px;
        }
        .header h1 {
            color: #4CAF50;
            margin: 0;
            font-size: 24px;
        }
        .header p {
            color: #666;
            margin: 10px 0 0 0;
            font-size: 14px;
        }
        .section {
            margin-bottom: 30px;
        }
        .section-title {
            font-size: 18px;
            font-weight: bold;
            color: #333;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #eee;
        }
        .info-row {
            display: flex;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        .info-label {
            font-weight: bold;
            color: #666;
            min-width: 100px;
        }
        .info-value {
            color: #333;
            flex: 1;
        }
        .status-success {
            color: #4CAF50;
            font-weight: bold;
        }
        .status-failed {
            color: #f44336;
            font-weight: bold;
        }
        .stats {
            display: flex;
            justify-content: space-around;
            margin: 20px 0;
            padding: 20px;
            background-color: #f9f9f9;
            border-radius: 8px;
        }
        .stat-item {
            text-align: center;
        }
        .stat-number {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
        }
        .stat-label {
            font-size: 14px;
            color: #666;
            margin-top: 5px;
        }
        .article-card {
            background-color: #f9f9f9;
            border-left: 4px solid #4CAF50;
            padding: 15px;
            margin-bottom: 15px;
            border-radius: 4px;
        }
        .article-card.failed {
            border-left-color: #f44336;
        }
        .article-title {
            font-size: 16px;
            font-weight: bold;
            color: #333;
            margin-bottom: 10px;
        }
        .article-info {
            font-size: 14px;
            color: #666;
            margin: 5px 0;
        }
        .article-platforms {
            display: inline-flex;
            gap: 8px;
            margin-top: 10px;
        }
        .platform-tag {
            background-color: #e3f2fd;
            color: #1976d2;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
        }
        .log-container {
            background-color: #f5f5f5;
            border-radius: 4px;
            padding: 15px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            max-height: 300px;
            overflow-y: auto;
        }
        .log-entry {
            margin: 5px 0;
            color: #333;
        }
        .log-time {
            color: #999;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            color: #999;
            font-size: 12px;
        }
        .footer a {
            color: #4CAF50;
            text-decoration: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📋 Memoraid 定时任务执行报告</h1>
            <p>任务已完成，以下是详细信息</p>
        </div>

        <div class="section">
            <div class="section-title">📊 任务概览</div>
            <div class="info-row">
                <div class="info-label">任务名称：</div>
                <div class="info-value">${body.taskName}</div>
            </div>
            <div class="info-row">
                <div class="info-label">执行时间：</div>
                <div class="info-value">${body.executionTime}</div>
            </div>
            <div class="info-row">
                <div class="info-label">任务状态：</div>
                <div class="info-value ${body.status === 'success' ? 'status-success' : 'status-failed'}">${body.status === 'success' ? '✅ 成功' : '❌ 失败'}</div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">📈 执行统计</div>
            <div class="stats">
                <div class="stat-item">
                    <div class="stat-number">${body.successCount}</div>
                    <div class="stat-label">成功发布</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number" style="color: #f44336;">${body.failedCount}</div>
                    <div class="stat-label">失败发布</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number" style="color: #2196F3;">${body.totalCount}</div>
                    <div class="stat-label">总计文章</div>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">📝 文章详情</div>
            ${articlesHtml}
        </div>

        <div class="section">
            <div class="section-title">📌 任务日志</div>
            <div class="log-container">
                ${logsHtml}
            </div>
        </div>

        <div class="footer">
            <p>此邮件由 Memoraid 自动发送，请勿回复</p>
            <p>如有问题，请访问：<a href="https://memoraid.dpdns.org">https://memoraid.dpdns.org</a></p>
        </div>
    </div>
</body>
</html>`;

        // 生成纯文本版本
        const textContent = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Memoraid 定时任务执行报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

任务名称：${body.taskName}
执行时间：${body.executionTime}
任务状态：${body.status === 'success' ? '✅ 成功' : '❌ 失败'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 执行统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• 成功发布：${body.successCount} 篇
• 失败发布：${body.failedCount} 篇
• 总计文章：${body.totalCount} 篇

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 文章详情
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${body.articles.map((article, index) => `
【文章 ${index + 1}】
状态：${article.status === 'success' ? '✅ 发布成功' : '❌ 发布失败'}
标题：${article.title}
素材来源：${article.sourceUrl}
发布平台：${article.platforms.join('、')}
发布时间：${article.publishTime}
${article.status === 'failed' && article.errorMessage ? `失败原因：${article.errorMessage}` : ''}
`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 任务日志
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${body.logs.map(log => {
  const icon = log.level === 'success' ? '✅' : 
              log.level === 'error' ? '❌' : 
              log.level === 'warn' ? '⚠️' : 'ℹ️';
  return `[${log.time}] ${icon} ${log.message}`;
}).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

此邮件由 Memoraid 自动发送，请勿回复。
如有问题，请访问：https://memoraid.dpdns.org
`;

        // 发送邮件
        const emailResponse = await sendEmailViaResend(env.RESEND_API_KEY, {
          from: 'onboarding@resend.dev',
          fromName: 'Memoraid',
          to: body.notificationEmail,
          subject: `[Memoraid] 定时任务执行完成 - ${body.taskName}`,
          text: textContent,
          html: emailTemplate
        });

        if (!emailResponse.ok) {
          const errorText = await emailResponse.text();
          console.error('发送邮件失败:', errorText);
          return new Response(JSON.stringify({ 
            error: '发送邮件失败', 
            details: errorText 
          }), {
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const emailResult = await emailResponse.json();
        console.log('邮件发送成功:', emailResult);

        return new Response(JSON.stringify({ 
          success: true,
          emailId: (emailResult as any).id
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        console.error('发送通知邮件错误:', e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 9.1 POST /api/tickets - 创建工单
    if (url.pathname === '/api/tickets' && request.method === 'POST') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const body = await request.json() as { subject: string; message: string };
        
        // 创建工单
        const ticketResult = await env.DB.prepare(
          'INSERT INTO tickets (user_id, subject, status) VALUES (?, ?, ?)'
        ).bind(userId, body.subject, 'open').run();
        
        const ticketId = ticketResult.meta.last_row_id;
        
        // 添加第一条消息
        await env.DB.prepare(
          'INSERT INTO ticket_messages (ticket_id, user_id, message, is_admin) VALUES (?, ?, ?, ?)'
        ).bind(ticketId, userId, body.message, 0).run();
        
        return new Response(JSON.stringify({ 
          success: true,
          ticketId 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        console.error('创建工单错误:', e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 9.2 GET /api/tickets - 获取用户的工单列表
    if (url.pathname === '/api/tickets' && request.method === 'GET') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const tickets = await env.DB.prepare(
          `SELECT t.*, 
           (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count,
           (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id AND is_admin = 1) as admin_reply_count
           FROM tickets t 
           WHERE t.user_id = ? 
           ORDER BY t.updated_at DESC`
        ).bind(userId).all();
        
        return new Response(JSON.stringify({ tickets: tickets.results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        console.error('获取工单列表错误:', e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 9.3 GET /api/tickets/:id - 获取工单详情和消息
    if (url.pathname.startsWith('/api/tickets/') && request.method === 'GET' && url.pathname.split('/').length === 4) {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const ticketId = url.pathname.split('/')[3];
        
        // 获取工单信息
        const ticket = await env.DB.prepare(
          'SELECT * FROM tickets WHERE id = ? AND user_id = ?'
        ).bind(ticketId, userId).first();
        
        if (!ticket) {
          return new Response(JSON.stringify({ error: 'Ticket not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 获取消息列表
        const messages = await env.DB.prepare(
          'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC'
        ).bind(ticketId).all();
        
        return new Response(JSON.stringify({ 
          ticket,
          messages: messages.results 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        console.error('获取工单详情错误:', e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 9.4 POST /api/tickets/:id/messages - 添加工单消息
    if (url.pathname.match(/^\/api\/tickets\/\d+\/messages$/) && request.method === 'POST') {
      try {
        const userId = getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const ticketId = url.pathname.split('/')[3];
        const body = await request.json() as { message: string };
        
        // 验证工单所有权
        const ticket = await env.DB.prepare(
          'SELECT * FROM tickets WHERE id = ? AND user_id = ?'
        ).bind(ticketId, userId).first();
        
        if (!ticket) {
          return new Response(JSON.stringify({ error: 'Ticket not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 添加消息
        await env.DB.prepare(
          'INSERT INTO ticket_messages (ticket_id, user_id, message, is_admin) VALUES (?, ?, ?, ?)'
        ).bind(ticketId, userId, body.message, 0).run();
        
        // 更新工单时间
        await env.DB.prepare(
          'UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(ticketId).run();
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        console.error('添加工单消息错误:', e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 9.5 GET /api/admin/tickets - 管理员获取所有工单
    if (url.pathname === '/api/admin/tickets' && request.method === 'GET') {
      try {
        // 验证管理员权限
        const adminCheck = verifyAdminToken(request);
        if (!adminCheck.valid) {
          const status = adminCheck.error === 'Forbidden' ? 403 : 401;
          return new Response(JSON.stringify({ error: adminCheck.error }), {
            status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const tickets = await env.DB.prepare(
          `SELECT t.*, u.email as user_email,
           (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count,
           (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id AND is_admin = 1) as admin_reply_count
           FROM tickets t 
           LEFT JOIN users u ON t.user_id = u.id
           ORDER BY t.updated_at DESC`
        ).all();
        
        return new Response(JSON.stringify({ tickets: tickets.results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        console.error('获取所有工单错误:', e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 9.6 GET /api/admin/tickets/:id - 管理员获取工单详情
    if (url.pathname.startsWith('/api/admin/tickets/') && request.method === 'GET' && url.pathname.split('/').length === 5) {
      try {
        // 验证管理员权限
        const adminCheck = verifyAdminToken(request);
        if (!adminCheck.valid) {
          const status = adminCheck.error === 'Forbidden' ? 403 : 401;
          return new Response(JSON.stringify({ error: adminCheck.error }), {
            status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const ticketId = url.pathname.split('/')[4];
        
        // 获取工单信息
        const ticket = await env.DB.prepare(
          'SELECT t.*, u.email as user_email FROM tickets t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?'
        ).bind(ticketId).first();
        
        if (!ticket) {
          return new Response(JSON.stringify({ error: 'Ticket not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 获取消息列表
        const messages = await env.DB.prepare(
          'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC'
        ).bind(ticketId).all();
        
        return new Response(JSON.stringify({ 
          ticket,
          messages: messages.results 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        console.error('管理员获取工单详情错误:', e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 9.7 POST /api/admin/tickets/:id/reply - 管理员回复工单
    if (url.pathname.match(/^\/api\/admin\/tickets\/\d+\/reply$/) && request.method === 'POST') {
      try {
        // 验证管理员权限
        const adminCheck = verifyAdminToken(request);
        if (!adminCheck.valid) {
          const status = adminCheck.error === 'Forbidden' ? 403 : 401;
          return new Response(JSON.stringify({ error: adminCheck.error }), {
            status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const ticketId = url.pathname.split('/')[4];
        const body = await request.json() as { message: string };
        
        // 添加管理员回复
        await env.DB.prepare(
          'INSERT INTO ticket_messages (ticket_id, user_id, message, is_admin) VALUES (?, ?, ?, ?)'
        ).bind(ticketId, userId, body.message, 1).run();
        
        // 更新工单状态和时间
        await env.DB.prepare(
          'UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind('replied', ticketId).run();
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        console.error('管理员回复工单错误:', e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 9.8 PATCH /api/admin/tickets/:id/status - 管理员更新工单状态
    if (url.pathname.match(/^\/api\/admin\/tickets\/\d+\/status$/) && request.method === 'PATCH') {
      try {
        // 验证管理员权限
        const adminCheck = verifyAdminToken(request);
        if (!adminCheck.valid) {
          const status = adminCheck.error === 'Forbidden' ? 403 : 401;
          return new Response(JSON.stringify({ error: adminCheck.error }), {
            status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const ticketId = url.pathname.split('/')[4];
        const body = await request.json() as { status: string };
        
        // 更新工单状态
        await env.DB.prepare(
          'UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(body.status, ticketId).run();
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e: any) {
        console.error('更新工单状态错误:', e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
