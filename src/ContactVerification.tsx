import { useEffect, useRef } from "react";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

export function ContactVerification({ onToken, resetKey }: { onToken: (value: string) => void; resetKey: number }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (!sitekey) return;
    let widget: string | undefined;
    const render = () => {
      if (container.current && window.turnstile && widget === undefined) {
        widget = window.turnstile.render(container.current, {
          sitekey, action: "contact", size: container.current.clientWidth < 300 ? "compact" : "flexible",
          callback: onToken, "expired-callback": () => onToken(""), "error-callback": () => onToken(""),
        });
      }
    };
    let script = document.querySelector<HTMLScriptElement>("script[data-contact-turnstile]");
    if (!script) {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.dataset.contactTurnstile = "true";
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    render();
    return () => {
      script.removeEventListener("load", render);
      if (widget !== undefined) window.turnstile?.remove(widget);
    };
  }, [onToken, resetKey]);
  return <div ref={container} className="contact-verification" />;
}
