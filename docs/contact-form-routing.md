# Cloudflare Pages + Resend setup

The site now uses Cloudflare Pages Functions at `/api/contact`; FormSubmit has been removed. Deploy as a Cloudflare **Pages** project with Functions, not a static-only upload. If you use Workers instead, this handler needs a Workers entry point.

## Activate sending

1. In Resend, add `yidigitalmm.com` as a sending domain. Copy the exact DNS records Resend provides into Cloudflare DNS and wait for verification. Do not replace unrelated existing mail records. The sender used by this project is `Yi Digital <inquiry@yidigitalmm.com>`; Reply-To goes to the Gmail inbox, so a separate mailbox for inquiry is not required.
2. Create a Resend API key restricted to sending for this domain.
3. In Cloudflare Turnstile, create a managed widget for `yidigitalmm.com` (and `www.yidigitalmm.com` if used). Add any preview hostname you want to test.
4. In your Cloudflare Pages project's production settings, configure:
   - **Secret** `RESEND_API_KEY`: the Resend sending key.
   - **Secret** `TURNSTILE_SECRET_KEY`: the Turnstile secret.
   - **Build environment variable** `VITE_TURNSTILE_SITE_KEY`: the public Turnstile site key.
5. Use build command `npm run build`, output directory `dist`, and repository root as the project root. Deploy with Git integration or Wrangler from the project root so `functions/api/contact.ts` is included. Dashboard drag-and-drop of `dist` alone does not deploy Pages Functions. Rebuild after setting the site key.
6. Submit a real enquiry using another email address you control. Confirm the business notification arrives at `yidigitalmm@gmail.com`, the customer confirmation arrives at the submitted address, and Reply works in both directions. Check spam folders and Resend delivery logs.

Do not paste API keys into chat, source code, or any `VITE_` variable. Only the Turnstile site key is public.

## Local preview

Vite forwards `/api` requests to the Cloudflare runtime at `http://127.0.0.1:8788`. Keep that runtime running when using the Vite preview. Vite alone does not run Cloudflare Functions. Build with the Turnstile site key configured and run `npx wrangler pages dev dist` from the project root. Put the two server secrets in an ignored `.dev.vars` file. For local testing, allow your local hostname in the real Turnstile widget settings. This endpoint requires the returned hostname and contact action to match, so generic dummy test keys are not compatible with its strict verification checks. Never deploy test keys to production.

The endpoint fails closed when secrets or verification are absent. The UI preserves entered fields after an error and offers the Gmail link. No email is sent during mocked automated tests.

## Email behavior

- The business email includes name, business name, customer email, phone, package interest, launch timing, and message. Reply addresses the customer.
- The customer receives a fixed English acknowledgement saying the enquiry was received and Yi Digital will contact them soon. Reply addresses `yidigitalmm@gmail.com`.
- Both messages are submitted in a Resend batch. Success means Resend accepted both, not that the receiving mail server placed them in an inbox.
- Server validation, same-origin checks, a honeypot, and server-verified Turnstile protect the endpoint. Add a Cloudflare rate-limiting rule for POST `/api/contact` as traffic grows.
- Matching enquiry retries within a UTC day use the same Resend idempotency key to reduce duplicates. Crossing midnight may send a new copy. There is no separate enquiry database; Resend delivery logs are the operational record.

References:
- https://developers.cloudflare.com/pages/functions/get-started/
- https://resend.com/docs/api-reference/emails/send-batch-emails
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
