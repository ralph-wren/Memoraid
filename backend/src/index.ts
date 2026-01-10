export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
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
            callbackUrl: url.origin + '/auth/callback/' + provider
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // 0.2 Privacy Policy (Public)
    if (url.pathname === '/privacy' && request.method === 'GET') {
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Privacy Policy - Memoraid</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #333; }
                h1 { border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 30px; }
                h2 { margin-top: 30px; color: #2c3e50; }
                ul { padding-left: 20px; }
                li { margin-bottom: 10px; }
                .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <h1>Privacy Policy for Memoraid</h1>
            <p><strong>Effective Date:</strong> January 7, 2026</p>

            <p>Memoraid ("we", "us", or "our") is committed to protecting your privacy. This Privacy Policy explains how our Chrome Extension collects, uses, and safeguards your information.</p>

            <h2>1. Information We Collect</h2>
            <p>We collect the minimum amount of data necessary to provide our services:</p>
            <ul>
                <li><strong>Authentication Data:</strong> When you log in using Google or GitHub, we receive your email address and a unique user identifier to manage your account.</li>
                <li><strong>Sync Data:</strong> We store your application settings and preferences to synchronize them across your devices.</li>
            </ul>

            <h2>2. How We Use Your Information</h2>
            <ul>
                <li>To provide, maintain, and improve the Memoraid extension.</li>
                <li>To synchronize your settings securely across multiple instances of the extension.</li>
                <li>To authenticate your identity and prevent unauthorized access.</li>
            </ul>

            <h2>3. Data Security & Encryption</h2>
            <p>Your privacy is our priority. We employ <strong>Client-Side Encryption</strong> (AES-GCM) for your sync data:</p>
            <ul>
                <li>Your settings are encrypted <strong>on your device</strong> before they are sent to our servers.</li>
                <li>We do not have access to your encryption password or your decrypted data.</li>
                <li>All data is transmitted over secure SSL/TLS (HTTPS) connections.</li>
            </ul>

            <h2>4. Third-Party Services</h2>
            <p>We use trusted third-party services for authentication:</p>
            <ul>
                <li><strong>Google OAuth:</strong> For user authentication.</li>
                <li><strong>GitHub OAuth:</strong> For user authentication.</li>
            </ul>
            <p>We do not sell, trade, or otherwise transfer your personally identifiable information to outside parties.</p>

            <h2>5. Data Retention & Deletion</h2>
            <p>We retain your encrypted data as long as you use our service. You may request the deletion of your account and all associated data by contacting us.</p>

            <h2>6. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page.</p>

            <div class="footer">
                <p>Contact Us: If you have any questions about this Privacy Policy, please contact us via the Chrome Web Store support page.</p>
            </div>
        </body>
        </html>
        `;
        return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=UTF-8' }
        });
    }

    // 1. Auth Init - Redirect to Provider
    if (url.pathname.startsWith('/auth/login/') && request.method === 'GET') {
       const provider = url.pathname.split('/').pop();
       const redirectUri = url.searchParams.get('redirect_uri');

       console.log('Auth Init:', { provider, redirectUri, origin: url.origin });

       if (!redirectUri) {
           console.error('Missing redirect_uri');
           return new Response('Missing redirect_uri', { status: 400 });
       }

       let authUrl = '';
       
       if (provider === 'google') {
           const clientId = env.GOOGLE_CLIENT_ID?.trim();
           if (!clientId) {
               console.error('GOOGLE_CLIENT_ID not configured');
               return new Response('Google OAuth not configured. Please set GOOGLE_CLIENT_ID environment variable.', { status: 500 });
           }
           authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(url.origin + '/auth/callback/google')}&response_type=code&scope=email%20profile&prompt=select_account&state=${encodeURIComponent(redirectUri)}`;
       } else if (provider === 'github') {
           const clientId = env.GITHUB_CLIENT_ID?.trim();
           if (!clientId) {
               console.error('GITHUB_CLIENT_ID not configured');
               return new Response('GitHub OAuth not configured. Please set GITHUB_CLIENT_ID environment variable.', { status: 500 });
           }
           authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(url.origin + '/auth/callback/github')}&scope=user:email&state=${encodeURIComponent(redirectUri)}`;
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
        const extRedirectUri = url.searchParams.get('state'); // We stored ext URI in state

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
                        redirect_uri: url.origin + '/auth/callback/google',
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
                        redirect_uri: url.origin + '/auth/callback/github'
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

            // Create/Update User - 使用 INSERT OR REPLACE 来处理所有冲突情况
            const userId = `${provider}_${providerId}`;
            
            // 先尝试更新现有用户，如果不存在则插入
            const existingUser = await env.DB.prepare(
                `SELECT id FROM users WHERE id = ? OR email = ?`
            ).bind(userId, email).first();
            
            if (existingUser) {
                // 更新现有用户
                await env.DB.prepare(
                    `UPDATE users SET email = ?, provider = ?, provider_id = ? WHERE id = ? OR email = ?`
                ).bind(email, provider, providerId, userId, email).run();
            } else {
                // 插入新用户
                await env.DB.prepare(
                    `INSERT INTO users (id, email, provider, provider_id) VALUES (?, ?, ?, ?)`
                ).bind(userId, email, provider, providerId).run();
            }

            // Generate App Token (Simple Mock JWT for demo, ideally use proper JWT lib)
            // For security, use a proper JWT library with signature in production
            const appToken = btoa(JSON.stringify({ userId, email, exp: Date.now() + 30 * 24 * 3600 * 1000 }));
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

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
