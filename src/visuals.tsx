import { getMedia } from "./cms/siteContent";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Link } from "react-router-dom";
import { copy, images, type Locale } from "./content";
import { translate } from "./i18n";
import { ButtonLink } from "./ui";

gsap.registerPlugin(useGSAP);

export function HeroVisual({ locale }: { locale: Locale }) {
  const c = copy[locale].home;
  const stageRef = useRef<HTMLDivElement>(null);
  const [isActive, setIsActive] = useState(false);
  const cards = [
    ["your-business", images.cardYourBusiness],
    ["urban-studio", images.cardUrbanStudio],
    ["green-house", images.cardGreenHouse],
    ["morning-brew", images.cardMorningBrew],
    ["north-co", images.cardNorthCo],
  ] as const;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsActive(entry.isIntersecting),
      { threshold: 0.2 },
    );

    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="hero-visual">
      <div
        className={`hero-browser-stage${isActive ? " is-active" : ""}`}
        ref={stageRef}
        role="img"
        aria-label={c.heroVisualLabel}
      >
        <img className="hero-browser-shell" src={images.heroBrowser} alt="" draggable={false} />
        <div className="hero-search-query" aria-hidden="true"><span>{c.searchQuery}</span></div>
        <div className="hero-results-loading" aria-hidden="true">
          <span />
          <strong>{c.searching}</strong>
        </div>
        <div className="hero-card-stack" aria-hidden="true">
          {cards.map(([name, src]) => (
            <img className={`hero-result-card hero-result-card-${name}`} src={src} alt="" draggable={false} key={name} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ServicesHero({ locale }: { locale: Locale }) {
  const t = (value: string) => translate(locale, "services", value);
  const visualRef = useRef<HTMLDivElement>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const visual = visualRef.current;
    if (!visual) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsActive(entry.isIntersecting),
      { threshold: 0.2 },
    );

    observer.observe(visual);
    return () => observer.disconnect();
  }, []);

  useGSAP(() => {
    const visual = visualRef.current;
    if (!visual) return;

    const storefront = visual.querySelector<HTMLElement>(".services-storefront-layer");
    const revealEdge = visual.querySelector<HTMLElement>(".services-scratch-edge");
    const panels = visual.querySelectorAll<HTMLElement>(".ecosystem-panel");
    const connections = visual.querySelector<SVGSVGElement>(".ecosystem-connections");
    const status = visual.querySelector<HTMLElement>(".ecosystem-status");
    const reduceMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!storefront || !revealEdge || !connections || !status) return;

    if (reduceMotion) {
      gsap.set(storefront, { clipPath: "polygon(100% 0, 100% 0, 100% 100%, 100% 100%)" });
      gsap.set([panels, connections, status], { autoAlpha: 1, clearProps: "transform" });
      gsap.set(revealEdge, { autoAlpha: 0 });
      return;
    }

    gsap.set(storefront, {
      clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)",
      scale: 1.012,
      transformOrigin: "left center",
    });
    gsap.set(revealEdge, { autoAlpha: 0, skewX: -4, xPercent: -100 });
    gsap.set(panels, { autoAlpha: 0, scale: 0.97, y: 18 });
    gsap.set(connections, { autoAlpha: 0 });
    gsap.set(status, { autoAlpha: 0, y: 12 });

    if (!isActive) return;

    const timeline = gsap.timeline({ paused: true });
    timeline
      .addLabel("reveal", 0.9)
      .to(revealEdge, { autoAlpha: 0.9, duration: 0.2, ease: "power2.out" }, "reveal")
      .to(storefront, {
        clipPath: "polygon(100% 0, 100% 0, 100% 100%, 100% 100%)",
        duration: 2.8,
        ease: "power4.inOut",
        scale: 1,
      }, "reveal")
      .to(revealEdge, { duration: 2.8, ease: "power4.inOut", xPercent: 720 }, "reveal")
      .to(connections, { autoAlpha: 1, duration: 0.55, ease: "power2.out" }, "reveal+=1")
      .to(panels, {
        autoAlpha: 1,
        duration: 0.72,
        ease: "power3.out",
        scale: 1,
        stagger: 0.12,
        y: 0,
      }, "reveal+=1.1")
      .to(status, { autoAlpha: 1, duration: 0.55, ease: "power3.out", y: 0 }, "reveal+=1.9")
      .to(revealEdge, { autoAlpha: 0, duration: 0.25, ease: "power2.out" }, "reveal+=2.75");

    timeline.play(0);
    return () => timeline.kill();
  }, { dependencies: [isActive], revertOnUpdate: true, scope: visualRef });

  return (
    <section className="page-hero services-story-hero">
      <div className="page-hero-copy">
        <p className="eyebrow">{t("Services")}</p>
        <h1>{t("What’s behind a successful business?")}</h1>
        <p>{t("Customers see a thriving business. Behind it is a connected online presence built to help them find, trust, and choose it.")}</p>
        <ButtonLink>{copy[locale].global.consultation}</ButtonLink>
        <a className="mobile-package-jump" href="#packages">{t("View packages")}</a>
      </div>
      <div
        className={`services-story-visual${isActive ? " is-active" : ""}`}
        ref={visualRef}
        role="img"
        aria-label={t("Part of the LILY & CO. flower shop remains visible as the connected online presence is revealed beside it")}
      >
        <div className="services-ecosystem" aria-hidden="true">
          <img className="ecosystem-backdrop" src={images.servicesStorefrontDiscovery} alt="" draggable={false} />
          <span className="services-story-label services-customer-label">{t("What customers see")}</span>
          <span className="services-story-label services-system-label">{t("What makes it work")}</span>
          <div className="ecosystem-canvas">
            <svg className="ecosystem-connections" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              <path id="ecosystem-search-profile" className="ecosystem-path" d="M 360 177 V 265" />
              <path className="ecosystem-path-flow ecosystem-flow-search" pathLength="100" d="M 360 177 V 265" />
              <path id="ecosystem-search-map" className="ecosystem-path" d="M 814 145 H 840 Q 870 145 870 175 V 344" />
              <path className="ecosystem-path-flow ecosystem-flow-search" pathLength="100" d="M 814 145 H 840 Q 870 145 870 175 V 344" />
              <path id="ecosystem-profile-junction" className="ecosystem-path" d="M 360 512 V 550 Q 360 580 390 580 H 478 Q 518 580 518 620 V 720" />
              <path className="ecosystem-path-flow ecosystem-flow-profile" pathLength="100" d="M 360 512 V 550 Q 360 580 390 580 H 478 Q 518 580 518 620 V 720" />
              <path id="ecosystem-junction-google" className="ecosystem-path" d="M 518 720 H 473" />
              <path className="ecosystem-path-flow ecosystem-flow-google" pathLength="100" d="M 518 720 H 473" />
              <path id="ecosystem-junction-social" className="ecosystem-path" d="M 518 720 H 562" />
              <path className="ecosystem-path-flow ecosystem-flow-google" pathLength="100" d="M 518 720 H 562" />
              <path id="ecosystem-map-social" className="ecosystem-path" d="M 789 611 V 678" />
              <path className="ecosystem-path-flow ecosystem-flow-map" pathLength="100" d="M 789 611 V 678" />
              <path id="ecosystem-social-ready" className="ecosystem-path" d="M 789 854 V 894 Q 789 924 759 924 H 613" />
              <path className="ecosystem-path-flow ecosystem-flow-ready" pathLength="100" d="M 789 854 V 894 Q 789 924 759 924 H 613" />
            </svg>
            <img className="ecosystem-search ecosystem-panel" src={images.ecosystemSearch} alt="" draggable={false} />
            <img className="ecosystem-profile ecosystem-panel" src={images.ecosystemBusiness} alt="" draggable={false} />
            <img className="ecosystem-map ecosystem-panel" src={images.ecosystemMap} alt="" draggable={false} />
            <img className="ecosystem-google ecosystem-panel" src={images.ecosystemGoogle} alt="" draggable={false} />
            <img className="ecosystem-social ecosystem-panel" src={images.ecosystemSocial} alt="" draggable={false} />
            <div className="ecosystem-status">{t("Visible")} <i /> {t("Trusted")} <i /> {t("Ready")}</div>
          </div>
        </div>
        <div className="services-storefront-layer" aria-hidden="true">
          <img src={images.servicesStorefrontDiscovery} alt="" draggable={false} />
          <span className="services-story-label">{t("What customers see")}</span>
        </div>
        <span className="services-scratch-edge" aria-hidden="true" />
      </div>
    </section>
  );
}

const perspectiveProjects = [
  ["Customizable", "Procurement service presence", images.contactPlanning, 30],
  ["Sein Htan Pin", "Exporter company profile", getMedia("projectExporter", "/images/projects/sein-htan-pin-preview.webp"), 20],
  ["The Peak", "Menu and contact presence", getMedia("projectRestaurant", "/images/projects/the-peak-preview.webp"), 10],
  ["Taunggyi Hotel", "Hotel presence and guest enquiries", getMedia("projectHotel", "/images/projects/taunggyi-hotel-preview.webp"), 0],
  ["In progress", "The next project is taking shape", getMedia("projectInProgress", "/images/projects/in-progress-card.png"), -10],
  ["More coming soon", "New work will appear here", getMedia("projectComingSoon", "/images/projects/more-coming-soon-card.png"), -20],
] as const;

export function PerspectiveProjectDeck({ locale }: { locale: Locale }) {
  const [activeCard, setActiveCard] = useState<number | null>(null);
  const c = copy[locale].home;

  return (
    <div className="perspective-stage">
      <div className="perspective-deck" aria-label={c.projectStackLabel}>
        {perspectiveProjects.map(([name, title, image, y], index) => (
          <article
            className={activeCard === index ? "perspective-card is-active" : "perspective-card"}
            key={name}
            style={{
              "--card-index": index,
              "--card-y": `${y}px`,
            } as CSSProperties}
          >
            <Link
              to="/our-work"
              aria-expanded={activeCard === index}
              aria-label={`${c.viewProject} ${c.projects[index][0]}: ${c.projects[index][1]}`}
              onClick={(event) => {
                const usesTouchInteraction = typeof window.matchMedia === "function"
                  && window.matchMedia("(hover: none) and (pointer: coarse)").matches;

                if (usesTouchInteraction && activeCard !== index) {
                  event.preventDefault();
                  setActiveCard(index);
                }
              }}
            >
              <img src={image} alt="" />
            </Link>
            {index < 4 ? <span><strong>{c.projects[index][0]}</strong><small>{c.projects[index][1]}</small></span> : null}
          </article>
        ))}
      </div>
      <p className="perspective-hint"><span>{c.hoverHint}</span><span>{c.tapHint}</span></p>
    </div>
  );
}
