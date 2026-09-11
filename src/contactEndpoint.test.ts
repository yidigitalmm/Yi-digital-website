import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/contact";
const env = { RESEND_API_KEY: "test-key", TURNSTILE_SECRET_KEY: "test-secret" };
const fields = { name: "Customer", email: "customer@example.com", message: "A website enquiry", businessName: "Example", phone: "123", packageInterest: "Hybrid", launchTiming: "Next month", token: "verified-token" };
const request = (body = fields, origin = "https://yidigitalmm.com") => new Request("https://yidigitalmm.com/api/contact", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
afterEach(() => vi.unstubAllGlobals());
function mockProvider() {
  const mock = vi.fn().mockResolvedValueOnce(Response.json({ success: true, hostname: "yidigitalmm.com", action: "contact" })).mockResolvedValueOnce(Response.json({ data: [{ id: "business" }, { id: "customer" }] }));
  vi.stubGlobal("fetch", mock); return mock;
}
describe("contact email routing", () => {
  it.each([undefined, "", "   "])("rejects missing or blank phone numbers (%s) before contacting providers", async (phone) => {
    const mock = mockProvider();
    const body = { ...fields, phone } as typeof fields;
    expect((await onRequest({ request: request(body), env })).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });
  it("sends both messages with the correct recipients and reply addresses", async () => {
    const mock = mockProvider();
    expect((await onRequest({ request: request(), env })).status).toBe(200);
    const messages = JSON.parse(mock.mock.calls[1][1].body);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ to: ["yidigitalmm@gmail.com"], reply_to: fields.email });
    expect(messages[0].text).toContain("Package interest: Hybrid");
    expect(messages[1]).toMatchObject({ to: [fields.email], reply_to: "yidigitalmm@gmail.com", from: "Yi Digital <inquiry@yidigitalmm.com>" });
    expect(messages[1].text).toContain("will contact you soon");
    expect(messages[1].text).not.toContain(fields.message);
  });
  it("fails closed without credentials", async () => {
    const mock = mockProvider();
    expect((await onRequest({ request: request(), env: {} })).status).toBe(503);
    expect(mock).not.toHaveBeenCalled();
  });
  it("rejects foreign origins and invalid email before contacting providers", async () => {
    const mock = mockProvider();
    expect((await onRequest({ request: request(fields, "https://other.example"), env })).status).toBe(403);
    expect((await onRequest({ request: request({ ...fields, email: "invalid" }), env })).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });
  it("does not send mail when bot verification fails", async () => {
    const mock = vi.fn().mockResolvedValue(Response.json({ success: false })); vi.stubGlobal("fetch", mock);
    expect((await onRequest({ request: request(), env })).status).toBe(400);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("does not claim success for a rejected email batch", async () => {
    const mock = mockProvider();
    mock.mockReset().mockResolvedValueOnce(Response.json({ success: true, hostname: "yidigitalmm.com", action: "contact" })).mockResolvedValueOnce(Response.json({ message: "secret provider detail" }, { status: 422 }));
    const response = await onRequest({ request: request(), env });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret provider detail");
  });
  it("reuses the provider idempotency key for identical retries", async () => {
    const mock = vi.fn().mockImplementation(async (url: string) => Response.json(url.includes("siteverify") ? { success: true, hostname: "yidigitalmm.com", action: "contact" } : { data: [{ id: "one" }, { id: "two" }] }));vi.stubGlobal("fetch", mock);
    await onRequest({ request: request(), env });await onRequest({ request: request({ ...fields, token: "fresh-token" }), env });
    const calls = mock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[1][1].headers).toEqual(calls[3][1].headers);
  });
});
