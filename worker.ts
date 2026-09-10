import { onRequest, type Env as ContactEnv } from "./functions/api/contact";
import { cmsAuth, type CmsAuthEnv } from "./functions/cms-auth";

type Env = ContactEnv & CmsAuthEnv & { ASSETS: { fetch: (request: Request) => Promise<Response> } };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/cms/auth" || pathname === "/api/cms/callback") return cmsAuth(request, env);
    if (pathname === "/api/contact") return onRequest({ request, env });
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return env.ASSETS.fetch(request);
  },
};
