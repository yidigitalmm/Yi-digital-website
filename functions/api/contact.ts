export type Env = { RESEND_API_KEY?: string; TURNSTILE_SECRET_KEY?: string };
const inbox = "yidigitalmm@gmail.com";
const reply = (status: number, error?: string) => Response.json(error ? { error } : { success: true }, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequest({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (request.method !== "POST") return reply(405, "Method not allowed");
  const origin = new URL(request.url).origin;
  if (request.headers.get("Origin") !== origin) return reply(403, "Invalid origin");
  if (!env.RESEND_API_KEY || !env.TURNSTILE_SECRET_KEY) return reply(503, "Email service unavailable");
  if (!request.headers.get("Content-Type")?.includes("application/json")) return reply(415, "Expected JSON");
  try {
    const raw = await request.text();
    if (raw.length > 15000) return reply(413, "Request too large");
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { return reply(400, "Invalid request"); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply(400, "Invalid request");
    const limits: Record<string, number> = { name: 120, businessName: 200, email: 254, phone: 60, packageInterest: 100, launchTiming: 100, message: 5000, token: 2048, website: 200 };
    const fields: Record<string, string> = {};
    for (const [key, max] of Object.entries(limits)) {
      const value = input[key] ?? "";
      if (typeof value !== "string" || value.length > max) return reply(400, "Invalid fields");
      fields[key] = value.trim();
    }
    if (fields.website) return reply(400, "Invalid submission");
    if (!fields.name || !fields.message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email) || !fields.token) return reply(400, "Missing required fields");
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: fields.token, remoteip: request.headers.get("CF-Connecting-IP") ?? undefined }),
    });
    const challenge = await verification.json() as { success?: boolean; hostname?: string; action?: string };
    if (!verification.ok || !challenge.success || challenge.hostname !== new URL(request.url).hostname || challenge.action !== "contact") return reply(400, "Verification failed");
    const labels = { name: "Name", businessName: "Business name", email: "Email", phone: "Phone", packageInterest: "Package interest", launchTiming: "Ideal launch timing", message: "Message" };
    const details = Object.entries(labels).map(([key, label]) => `${label}: ${fields[key] || "Not provided"}`).join("\n\n");
    // Identical retries within the day use the same provider key, avoiding duplicate emails.
    const bytes = new TextEncoder().encode(new Date().toISOString().slice(0, 10) + details);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    const from = "Yi Digital <inquiry@yidigitalmm.com>";
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `contact-${hash}` },
      body: JSON.stringify([
        { from, to: [inbox], reply_to: fields.email, subject: "New Yi Digital consultation request", text: details },
        { from, to: [fields.email], reply_to: inbox, subject: "We received your enquiry — Yi Digital", text: "Thank you for contacting Yi Digital.\n\nWe have received your enquiry and will contact you soon to discuss your business and the next steps.\n\nIf you would like to add anything, reply to this email or call +95 9251183379.\n\nYi Digital\n132 Bogalayzay Street, Botahtaung Township, Yangon, 11161" },
      ]),
    });
    const result = await response.json() as { data?: { id?: string }[] };
    if (!response.ok || result.data?.length !== 2 || !result.data.every(email => email.id)) return reply(502, "Email service unavailable");
    return reply(200);
  } catch {
    // Do not expose provider errors, credentials, or customer details to the browser/logs.
    return reply(502, "Email service unavailable");
  }
}
