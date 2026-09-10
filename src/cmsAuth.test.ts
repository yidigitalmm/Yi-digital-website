import { afterEach, describe, expect, it, vi } from 'vitest';
import { cmsAuth } from '../functions/cms-auth';
const env = { GITHUB_CLIENT_ID: 'client', GITHUB_CLIENT_SECRET: 'secret' };
const start = () => cmsAuth(new Request('https://yidigitalmm.com/api/cms/auth?provider=github'),env);
afterEach(()=>vi.unstubAllGlobals());
async function loginRequest() {
  const response=await start();
  const state=new URL(response.headers.get('Location')!).searchParams.get('state');
  return new Request(`https://yidigitalmm.com/api/cms/callback?state=${state}&code=test-code`,{headers:{Cookie:response.headers.get('Set-Cookie')!.split(';')[0]}});
}
describe('Decap GitHub authentication',()=>{
  it('fails closed without configuration and rejects foreign origins and methods',async()=>{
    expect((await cmsAuth(new Request('https://yidigitalmm.com/api/cms/auth?provider=github'),{})).status).toBe(503);
    expect((await cmsAuth(new Request('https://other.example/api/cms/auth?provider=github'),env)).status).toBe(403);
    expect((await cmsAuth(new Request('https://yidigitalmm.com/api/cms/auth',{method:'POST'}),env)).status).toBe(405);
  });
  it('uses a fixed redirect, random state, PKCE, and an HttpOnly secure cookie',async()=>{
    const response=await start();const location=new URL(response.headers.get('Location')!);
    expect(location.origin).toBe('https://github.com');
    expect(location.searchParams.get('redirect_uri')).toBe('https://yidigitalmm.com/api/cms/callback');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toHaveLength(43);
    expect(response.headers.get('Set-Cookie')).toMatch(/__Host-decap_oauth=.*HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
    expect(response.headers.get('Location')).not.toContain('secret');
    expect((await start()).headers.get('Location')).not.toBe(response.headers.get('Location'));
  });
  it('rejects a missing or forged state before exchanging a token',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const response=await cmsAuth(new Request('https://yidigitalmm.com/api/cms/callback?code=bad&state=forged'),env);
    expect(await response.text()).toContain('Sign-in failed');expect(fetch).not.toHaveBeenCalled();
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
  it('checks repository write access before releasing the token to the editor',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({access_token:'test-token'})).mockResolvedValueOnce(Response.json({permissions:{push:true}}));vi.stubGlobal('fetch',fetch);
    const response=await cmsAuth(await loginRequest(),env);const html=await response.text();
    expect(fetch.mock.calls[1][0]).toBe('https://api.github.com/repos/yidigitalmm/Yi-digital-website');
    expect(JSON.parse(fetch.mock.calls[0][1].body).code_verifier).toHaveLength(43);
    expect(html).toContain('authorization:github:success:');
    expect(html).toContain('event.origin !== target || event.source !== window.opener');
    expect(html).not.toContain('secret');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
  it('never returns a token to someone without repository write access',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({access_token:'private-token'})).mockResolvedValueOnce(Response.json({permissions:{push:false}}));vi.stubGlobal('fetch',fetch);
    const html=await(await cmsAuth(await loginRequest(),env)).text();
    expect(html).toContain('authorization:github:error:');expect(html).not.toContain('private-token');
  });
  it('escapes script delimiters in the popup response',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({access_token:'</script><script>bad'})).mockResolvedValueOnce(Response.json({permissions:{push:true}}));vi.stubGlobal('fetch',fetch);
    const html=await(await cmsAuth(await loginRequest(),env)).text();
    expect(html).not.toContain('</script><script>bad');
  });
});
