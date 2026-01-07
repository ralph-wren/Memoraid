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

    // 4. POST Logs (Debug Mode)
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

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
