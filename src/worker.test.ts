import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker";

afterEach(() => vi.unstubAllGlobals());

describe("Worker contact routing", () => {
  it("delivers a verified POST through the contact handler instead of static assets", async () => {
    const providers = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, hostname: "yidigitalmm.com", action: "contact" }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "business" }, { id: "customer" }] }));
    vi.stubGlobal("fetch", providers);
    const assets = vi.fn().mockResolvedValue(new Response(null, { status: 405 }));
    const request = new Request("https://yidigitalmm.com/api/contact", {
      method: "POST", headers: { Origin: "https://yidigitalmm.com", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Customer", email: "customer@example.com", message: "Enquiry", token: "test-token" }),
    });
    const response = await worker.fetch(request, { ASSETS: { fetch: assets }, RESEND_API_KEY: "test", TURNSTILE_SECRET_KEY: "test" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(providers).toHaveBeenCalledTimes(2);
    expect(assets).not.toHaveBeenCalled();
  });

  it("keeps missing secrets and unsupported methods in the API, without falling back to HTML", async () => {
    const assets = vi.fn();
    const env = { ASSETS: { fetch: assets } };
    const post = await worker.fetch(new Request("https://yidigitalmm.com/api/contact", {
      method: "POST", headers: { Origin: "https://yidigitalmm.com" },
    }), env);
    expect(post.status).toBe(503);
    expect(await post.json()).toEqual({ error: "Email service unavailable" });
    expect((await worker.fetch(new Request("https://yidigitalmm.com/api/contact"), env)).status).toBe(405);
    expect(assets).not.toHaveBeenCalled();
  });

  it("returns JSON 404 for unknown API routes, including browser navigation", async () => {
    const assets = vi.fn();
    const response = await worker.fetch(new Request("https://yidigitalmm.com/api/missing", {
      headers: { "Sec-Fetch-Mode": "navigate" },
    }), { ASSETS: { fetch: assets } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(assets).not.toHaveBeenCalled();
  });

  it.each(["/contact", "/assets/app.js", "/missing-page"])("preserves asset handling for %s", async path => {
    const expected = new Response("Asset response", { status: path === "/missing-page" ? 404 : 200 });
    const assets = vi.fn().mockResolvedValue(expected);
    const request = new Request(`https://yidigitalmm.com${path}`);
    expect(await worker.fetch(request, { ASSETS: { fetch: assets } })).toBe(expected);
    expect(assets).toHaveBeenCalledWith(request);
  });
});
