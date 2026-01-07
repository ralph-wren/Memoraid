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

    // 1. Auth Init - Redirect to Provider
    if (url.pathname.startsWith('/auth/login/') && request.method === 'GET') {
       const provider = url.pathname.split('/').pop();
       const redirectUri = url.searchParams.get('redirect_uri');

       if (!redirectUri) return new Response('Missing redirect_uri', { status: 400 });

       if (provider === 'google') {
           const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(url.origin + '/auth/callback/google')}&response_type=code&scope=email profile&state=${encodeURIComponent(redirectUri)}`;
           return Response.redirect(authUrl, 302);
       } else if (provider === 'github') {
           const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(url.origin + '/auth/callback/github')}&scope=user:email&state=${encodeURIComponent(redirectUri)}`;
           return Response.redirect(authUrl, 302);
       }
       return new Response('Invalid provider', { status: 400 });
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
                        client_id: env.GOOGLE_CLIENT_ID,
                        client_secret: env.GOOGLE_CLIENT_SECRET,
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

            // Create/Update User
            const userId = `${provider}_${providerId}`;
            await env.DB.prepare(
                `INSERT INTO users (id, email, provider, provider_id) VALUES (?, ?, ?, ?) 
                 ON CONFLICT(email) DO UPDATE SET id=id` // Keep existing ID if email matches
            ).bind(userId, email, provider, providerId).run();

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
      const body = await request.json() as SaveSettingsRequest;
      const { encryptedData, salt, iv } = body;

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
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
