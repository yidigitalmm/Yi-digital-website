import { type RefObject } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const entryTargets = [
  ".home-hero-copy > :is(h1, p)",
  ".page-hero-copy > :is(h1, p)",
  ".section-title > :is(h1, h2, p)",
  ".outcome-cards article",
  ".comparison-story article > :is(h2, p)",
  ".service-list a",
  ".package-card > :is(h3, p, .price, ul)",
  ".mobile-package > summary",
  ".connected-presence > div > :is(h2, p)",
  ".addon-grid article",
  ".process-step",
  ".assurance-band > div",
  ".featured-journal-grid > img",
  ".featured-journal-grid article > :is(h2, p)",
  ".journal-grid article",
  ".article-row article",
  ".topic-grid article",
  ".project-case-media",
  ".project-case-story > :is(h2, p)",
  ".journal-article-heading > :is(h1, p)",
  ".journal-article-hero > img",
  ".journal-article-body > section",
  ".consultation-band > :is(h2, p)",
  ".journal-consult h2, .work-cta h2, .package-reference h2",
  ".next-steps h2, .preparation h2, .reassurance h2",
].join(", ");

export function useEntryAnimations(root: RefObject<HTMLElement | null>, pathname: string) {
  useGSAP(() => {
    const element = root.current;
    // The interactive showcase owns its motion; CSS keeps content visible without JS.
    if (!element || pathname === "/motion" || typeof window.matchMedia !== "function"
      || typeof IntersectionObserver === "undefined") return;

    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", (context) => {
      const mobile = window.matchMedia("(max-width: 820px)").matches;
      const targets = Array.from(element.querySelectorAll<HTMLElement>(entryTargets))
        .filter(target => !target.closest("form, nav") && !target.classList.contains("button"));
      const pending = new Set(targets);
      const cardIndexes = new Map<Element, number>();

      targets.forEach(target => {
        let from: gsap.TweenVars = { opacity: 0, y: mobile ? 22 : 32 };
        if (target.matches("img, .project-case-media")) {
          from = { opacity: 0, scale: 0.94 };
        } else if (target.matches("article, .service-list a, .process-step, .assurance-band > div, summary")) {
          const parent = target.parentElement!;
          const index = cardIndexes.get(parent) ?? 0;
          cardIndexes.set(parent, index + 1);
          from = { opacity: 0, x: (index % 2 ? 1 : -1) * (mobile ? 18 : 30) };
        } else if (target.matches("p")) {
          from = { opacity: 0 };
        }
        gsap.set(target, from);
      });

      // Register asynchronous reveals with the same context for route/preference cleanup.
      context.add("reveal", (batch: HTMLElement[]) => {
        gsap.to(batch, {
          opacity: 1, x: 0, y: 0, scale: 1,
          duration: mobile ? 0.95 : 1.1,
          ease: "power2.out",
          stagger: { each: 0.12, amount: Math.min((batch.length - 1) * 0.12, 0.36) },
          clearProps: "opacity,transform",
          overwrite: "auto",
        });
      });
      const observer = new IntersectionObserver(entries => {
        const batch = entries.filter(entry => entry.isIntersecting && pending.has(entry.target as HTMLElement))
          .map(entry => entry.target as HTMLElement);
        if (!batch.length) return;
        batch.forEach(target => {
          pending.delete(target);
          observer.unobserve(target);
        });
        context.reveal(batch);
      }, { threshold: 0, rootMargin: "0px 0px -64px 0px" });
      targets.forEach(target => observer.observe(target));

      // Keyboard users never have to wait for an invisible link or accordion control.
      const onFocus = (event: FocusEvent) => {
        targets.filter(target => target.contains(event.target as Node)).forEach(target => {
          pending.delete(target);
          observer.unobserve(target);
          gsap.killTweensOf(target);
          gsap.set(target, { clearProps: "opacity,transform" });
        });
      };
      element.addEventListener("focusin", onFocus);
      return () => {
        observer.disconnect();
        element.removeEventListener("focusin", onFocus);
      };
    });
    return () => media.revert();
  }, { scope: root, dependencies: [pathname], revertOnUpdate: true });
}
