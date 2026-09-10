export type CmsAuthEnv = { GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string };
const origin = 'https://yidigitalmm.com';
const callback = `${origin}/api/cms/callback`;
const cookieName = '__Host-decap_oauth';
const cookieOptions = 'Path=/; HttpOnly; Secure; SameSite=Lax';
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const json = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
const safe = (value: unknown) => JSON.stringify(value).replaceAll('<','\\u003c');

function finish(token?: string): Response {
  const nonce = random();
  const message = token ? `authorization:github:success:${JSON.stringify({ token, provider: 'github' })}` : `authorization:github:error:${JSON.stringify({ message: 'Sign-in failed. Check repository access and try again.' })}`;
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Yi Digital sign-in</title><p>${token ? 'Signed in. Returning to the editor…' : 'Sign-in failed. Close this window and try again.'}</p><script nonce="${nonce}">
const target = ${safe(origin)};
function receive(event) {
  if (event.origin !== target || event.source !== window.opener || event.data !== 'authorizing:github') return;
  window.removeEventListener('message', receive);
  window.opener.postMessage(${safe(message)}, target);
}
if (window.opener) {
  window.addEventListener('message', receive);
  window.opener.postMessage('authorizing:github', target);
}
</script></html>`, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`,
    'Set-Cookie': `${cookieName}=; ${cookieOptions}; Max-Age=0`,
  } });
}

export async function cmsAuth(request: Request, env: CmsAuthEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json(405, 'Method not allowed');
  if (url.origin !== origin) return json(403, 'Use the production editor address');
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return json(503, 'CMS sign-in is not configured');
  if (url.pathname === '/api/cms/auth') {
    if (url.searchParams.get('provider') !== 'github') return json(400, 'Unsupported provider');
    const state = random(), verifier = random();
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const auth = new URL('https://github.com/login/oauth/authorize');
    auth.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callback, scope: 'repo', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return new Response(null, { status: 302, headers: { Location: auth.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': `${cookieName}=${state}.${verifier}; ${cookieOptions}; Max-Age=600` } });
  }
  if (url.pathname !== '/api/cms/callback') return json(404, 'Not found');
  const session = request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const [state, verifier] = session?.split('.') ?? [];
  const code = url.searchParams.get('code');
  if (!state || !verifier || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(verifier) || state !== url.searchParams.get('state') || !code || code.length > 512 || url.searchParams.has('error')) return finish();
  try {
    const exchange = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: callback, code_verifier: verifier }),
    });
    const result = await exchange.json() as { access_token?: string; error?: string };
    if (!exchange.ok || result.error || !result.access_token) return finish();
    const access = await fetch('https://api.github.com/repos/yidigitalmm/Yi-digital-website', {
      signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${result.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Yi-Digital-CMS' },
    });
    const repository = await access.json() as { permissions?: { push?: boolean } };
    if (!access.ok || repository.permissions?.push !== true) return finish();
    return finish(result.access_token);
  } catch { return finish(); }
}
