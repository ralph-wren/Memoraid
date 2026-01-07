import { getSettings } from './storage';

export const reportError = async (error: Error | string, context?: any) => {
  try {
    const settings = await getSettings();
    if (!settings.debugMode) return;

    const errorMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    
    const payload = {
      error: errorMsg,
      stack,
      context,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    // Use the configured backend URL or default
    const backendUrl = settings.sync?.backendUrl || 'https://memoraid-backend.iuyuger.workers.dev';
    
    // Fire and forget - don't await result to avoid blocking
    fetch(`${backendUrl}/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).catch(e => console.error('Failed to report error:', e));

  } catch (e) {
    console.error('Error reporting failed:', e);
  }
};
