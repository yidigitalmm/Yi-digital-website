import { business, getMedia } from "./cms/siteContent";
import { type ElementType, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  ClipboardCheck,
  Compass,
  Eye,
  Handshake,
  MapPin,
  Menu,
  MessageCircle,
  Moon,
  Rocket,
  Search,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { SiFacebook, SiInstagram, SiTiktok } from "react-icons/si";
import { FaLinkedinIn } from "react-icons/fa";
import { Link, NavLink, useLocation } from "react-router-dom";
import { copy, type Locale } from "./content";
import { localize, translate, type CopySection } from "./i18n";

export type Theme = "light" | "dark";

const routes = [
  ["/", 0],
  ["/services", 1],
  ["/our-work", 3],
  ["/journal", 4],
  ["/contact", 5],
  ["/motion", 2],
] as const;

export const assuranceItems: ReadonlyArray<[ElementType, string, string]> = [
  [MessageCircle, "Calm Consultation", "A relaxed conversation to understand your business, goals, and concerns."],
  [ClipboardCheck, "Clear Scope", "We turn what we learn into clear priorities, deliverables, and boundaries."],
  [Compass, "Considered Recommendation", "We recommend the best-fit package, options, timing, and investment."],
  [Handshake, "Shared Agreement", "You review and approve the full plan before any implementation work begins."],
];

export const topicItems: ReadonlyArray<[ElementType, string, { label: string; slug: string }[]]> = [
  [Eye, "Visibility", [
    { label: "Show up where customers search", slug: "why-online-presence-matters" },
    { label: "Your Google profile checklist", slug: "complete-google-business-profile" },
    { label: "Make it easy to contact you", slug: "what-customers-expect-before-contact" },
  ]],
  [ShieldCheck, "Trust", [
    { label: "Build credibility online", slug: "consistency-builds-trust" },
    { label: "Professional email matters", slug: "why-business-email-matters" },
    { label: "Reviews and reputation", slug: "complete-google-business-profile" },
  ]],
  [MapPin, "Local Search", [
    { label: "Be found in your area", slug: "why-online-presence-matters" },
    { label: "Maps, directions and hours", slug: "complete-google-business-profile" },
    { label: "Local SEO essentials", slug: "complete-google-business-profile" },
  ]],
  [BriefcaseBusiness, "Foundations", [
    { label: "Website must-haves", slug: "website-as-calm-salesperson" },
    { label: "Domain, email and basics", slug: "what-to-prepare-before-going-online" },
    { label: "Plan your online presence", slug: "what-to-prepare-before-going-online" },
  ]],
];

export function ScrollReset() {
  const { pathname, hash } = useLocation();
  useLayoutEffect(() => {
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  }, [pathname, hash]);
  return null;
}

function Brand() {
  return (
    <Link className="brand" to="/" aria-label={`${business.brandName} home`}>
      <img className="brand-logo brand-logo-light" src={getMedia("logoLight", "/brand/yi-digital-horizontal-light.svg")} alt={business.brandName} width="375" height="152" />
      <img className="brand-logo brand-logo-dark" src={getMedia("logoDark", "/brand/yi-digital-horizontal-dark.svg")} alt={business.brandName} width="375" height="152" />
    </Link>
  );
}

export function ButtonLink({ children, to = "/contact", tone = "ink" }: { children: ReactNode; to?: string; tone?: "ink" | "gold" | "outline" }) {
  return (
    <Link className={`button button-${tone}`} to={to}>
      {children}
    </Link>
  );
}

export function Header({ locale, theme, onLocale, onTheme }: { locale: Locale; theme: Theme; onLocale: () => void; onTheme: () => void }) {
  const [open, setOpen] = useState(false);
  const navigation = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.key]);

  useEffect(() => {
    if (!open) return;
    navigation.current?.querySelector<HTMLAnchorElement>("a")?.focus({ preventScroll: true });
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !navigation.current?.contains(event.target) && !menuButton.current?.contains(event.target)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      menuButton.current?.focus({ preventScroll: true });
    };
    const dismissOnDesktop = () => {
      if (window.innerWidth > 1160) setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("resize", dismissOnDesktop);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("resize", dismissOnDesktop);
    };
  }, [open]);

  return (
    <header className="site-header">
      <Brand />
      <nav ref={navigation} id="primary-navigation" className={open ? "primary-nav is-open" : "primary-nav"} aria-label={copy[locale].global.primaryNavigation}>
        {routes.map(([path, index]) => (
          <NavLink key={path} to={path} onClick={() => setOpen(false)}>
            {copy[locale].global.nav[index]}
          </NavLink>
        ))}
      </nav>
      <div className="header-controls">
        <button className="text-control" aria-label={copy[locale].global.language} onClick={onLocale} type="button">
          {locale === "en" ? "မြန်မာ" : "EN"}
        </button>
        <button className="round-control" aria-label={translate(locale, "global", theme === "light" ? "Switch to dark mode" : "Switch to light mode")} onClick={onTheme} type="button">
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </button>
        <ButtonLink>{copy[locale].global.consultation}</ButtonLink>
        <button ref={menuButton} className="menu-control" aria-label={copy[locale].global.toggleNavigation} aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen((value) => !value)} type="button">
          {open ? <X /> : <Menu />}
        </button>
      </div>
    </header>
  );
}

export function Footer({ locale }: { locale: Locale }) {
  const c = copy[locale].global;
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <Brand />
        <p className="copyright">{c.copyright}</p>
        <div className="footer-social" aria-label={c.socialMedia}>
          <a href={business.facebook} aria-label="Facebook" target="_blank" rel="noreferrer"><SiFacebook /></a>
          <a href={business.instagram} aria-label="Instagram" target="_blank" rel="noreferrer"><SiInstagram /></a>
          <a href={business.tiktok} aria-label="TikTok" target="_blank" rel="noreferrer"><SiTiktok /></a>
          <a href={business.linkedin} aria-label="LinkedIn" target="_blank" rel="noreferrer"><FaLinkedinIn /></a>
        </div>
      </div>
    </footer>
  );
}

export function SectionTitle({ eyebrow, title, body, as: Heading = "h2" }: { eyebrow?: string; title: string; body?: string; as?: "h1" | "h2" }) {
  return (
    <div className="section-title">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <Heading>{title}</Heading>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

const processSteps = [
  ["Discover", "We learn about your business, goals, and your customers.", Search],
  ["Define", "We plan your presence and align the essentials for success.", Compass],
  ["Build", "We create, configure, and customize your online foundation.", BriefcaseBusiness],
  ["Launch", "We test, launch, and ensure everything is working perfectly.", Rocket],
] as const;

export function Process({ locale, title = "A considered path to launch.", section = "global" }: { locale: Locale; title?: string; section?: CopySection }) {
  const steps = localize(locale, "global", processSteps);
  return (
    <section className="section process-section">
      <SectionTitle eyebrow={translate(locale, "global", "Our process")} title={translate(locale, section, title)} />
      <div className="process-row">
        {steps.map(([name, body, Icon], index) => (
          <div className="process-step" key={name}>
            <div className="process-icon"><span>{index + 1}</span><Icon size={23} /></div>
            <h3>{name}</h3>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ConsultationBand({ locale = "en", title }: { locale?: Locale; title?: string }) {
  const c = copy[locale];
  return (
    <section className="consultation-band">
      <div>
        <p className="eyebrow">{c.home.consultationEyebrow}</p>
        <h2>{title ?? c.home.consultationTitle}</h2>
        <p>{c.home.consultationBody}</p>
        <ButtonLink tone="gold">{c.global.consultation}</ButtonLink>
      </div>
    </section>
  );
}
