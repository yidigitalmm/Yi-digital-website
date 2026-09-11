import { business, interfaceText } from "./cms/siteContent";
import { type FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import { PageMetadata } from "./PageMetadata";
import { ContactVerification } from "./ContactVerification";
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Check,
  Compass,
  Eye,
  ExternalLink,
  Globe2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useEntryAnimations } from "./useEntryAnimations";
import { SiGoogle } from "react-icons/si";
import { Link, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from "react-router-dom";
import { copy, images, type Locale, packages } from "./content";
import { getArticles, getWork } from "./cms/content";
import { localize, translate } from "./i18n";
const AnimationShowcasePage = lazy(() => import("./animationShowcase").then(module => ({ default: module.AnimationShowcasePage })));
import {
  assuranceItems,
  ButtonLink,
  ConsultationBand,
  Process,
  SectionTitle,
  topicItems,
} from "./ui";
import { HeroVisual, PerspectiveProjectDeck, ServicesHero } from "./visuals";

function HomePage({ locale }: { locale: Locale }) {
  const c = copy[locale].home;
  const capabilityIcons = [Globe2, SiGoogle, Users, Mail, BarChart3] as const;
  const outcomeIcons = [Eye, ShieldCheck, BarChart3] as const;
  return (
    <>
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">{c.heroEyebrow}</p>
          <h1>{c.hero}</h1>
          <p className="hero-accent">{c.heroAccent}</p>
          <p className="hero-body">{c.heroBody}</p>
          <div className="button-row"><ButtonLink>{copy[locale].global.consultation}</ButtonLink><ButtonLink tone="outline" to="/services">{c.exploreServices}</ButtonLink></div>
        </div>
        <HeroVisual locale={locale} />
      </section>

      <section className="capability-strip">
        {c.capabilities.map(([name, detail], index) => { const Icon = capabilityIcons[index]; return <div key={name}><Icon /><span><strong>{name}</strong><small>{detail}</small></span></div>; })}
      </section>

      <div className="home-transformation-story">
        <div className="outcome-reveal">
          <section className="section outcome-section">
            <SectionTitle eyebrow={c.outcomeEyebrow} title={c.outcomeTitle} />
            <div className="outcome-cards">
              {c.outcomes.map(([title, body], index) => { const Icon = outcomeIcons[index]; return <article key={title}><Icon /><h3>{title}</h3><p>{body}</p></article>; })}
            </div>
          </section>
        </div>

        <section className="section comparison-story">
          <article><p className="eyebrow">{c.before[0]}</p><h2>{c.before[1]}</h2><p>{c.before[2]}</p><div className="mini-search"><Search size={15} /> {c.coffeeSearch}</div><div className="ghost-results"><i /><i /></div></article>
          <article><p className="eyebrow">{c.after[0]}</p><h2>{c.after[1]}</h2><p>{c.after[2]}</p><div className="mini-search"><Search size={15} /> {c.coffeeSearch}</div><div className="result"><img src={images.cafeCounter} alt="" /><span><strong>Brew & Co. Coffee</strong><small>{c.openStatus}</small></span></div></article>
        </section>
      </div>

      <section className="section service-list-section">
        <SectionTitle eyebrow={c.servicesEyebrow} title={c.servicesTitle} />
        <div className="service-list">
          {c.services.map(([name, body], index) => <Link to="/services" key={name}><b>0{index + 1}</b><strong>{name}</strong><span>{body}</span><ArrowRight /></Link>)}
        </div>
      </section>

      <section className="section work-preview">
        <SectionTitle eyebrow={c.workEyebrow} title={c.workTitle} />
        <PerspectiveProjectDeck locale={locale} />
      </section>

      <section className="section journal-preview">
        <div className="journal-intro">
          <SectionTitle eyebrow={c.journalEyebrow} title={c.journalTitle} />
          <ButtonLink tone="outline" to="/journal">{c.learnMore}</ButtonLink>
        </div>
        <div className="article-row" tabIndex={0} role="region" aria-label={interfaceText(locale, "Journal articles")}>
          {getArticles(locale).slice(0, 3).map((article) => <article key={article.slug}><img src={article.image} alt={article.imageAlt} /><h3>{article.title}</h3><p>{article.summary}</p><Link to={`/journal/${article.slug}`}>{c.readArticle} <ArrowRight size={14} /></Link></article>)}
        </div>
      </section>
      <ConsultationBand locale={locale} />
    </>
  );
}

function ServicesPage({ locale }: { locale: Locale }) {
  const c = copy[locale].services;
  const t = (value: string) => translate(locale, "services", value);
  const localizedPackages = c.packages.options;
  const localizedRows = c.packages.comparisonRows;
  const localizedTerms = c.packages.terms;
  const localizedAssurances = localize(locale, "services", assuranceItems);
  return (
    <>
      <ServicesHero locale={locale} />
      <section className="section packages-section" id="packages">
        <SectionTitle eyebrow={t("Packages")} title={t("A clear path from presence to growth.")} />
        <div className="mobile-package-overview" aria-label={t("Package options")}>
          <p>{t("Choose a package to see what is included.")}</p>
          {localizedPackages.map((pkg, index) => <details className="mobile-package" key={pkg.name}>
            <summary>
              {pkg.recommended ? <small>{t("Recommended")}</small> : null}
              <span className="mobile-package-title">{pkg.name}<span aria-hidden="true">+</span></span>
              <strong>{pkg.price}</strong>
              <span className="mobile-package-summary">{pkg.summary}</span>
            </summary>
            <div className="mobile-package-details">
              <ButtonLink to={`/contact?package=${encodeURIComponent(packages[index].name)}#contact-form`} tone={pkg.recommended ? "gold" : "outline"}>{t("Select this package")}</ButtonLink>
              <ul>{pkg.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
              <dl>{localizedRows.map((row) => <div key={row[0]}><dt>{row[0]}</dt><dd>{row[index + 1]}</dd></div>)}</dl>
            </div>
          </details>)}
        </div>
        <div className="package-grid" aria-label={t("Package options")}>
          {localizedPackages.map((pkg, index) => <article className={pkg.recommended ? "package-card recommended" : "package-card"} key={pkg.name}>{pkg.recommended ? <span className="recommendation">{t("Recommended")}</span> : null}<span className="package-numeral">{pkg.numeral}</span><h3>{pkg.name}</h3><strong className="price">{pkg.price}</strong><p>{pkg.summary}</p><ul>{pkg.bullets.map((bullet) => <li key={bullet}><Check size={15} />{bullet}</li>)}</ul><ButtonLink to={`/contact?package=${encodeURIComponent(packages[index].name)}#contact-form`} tone={pkg.recommended ? "gold" : "outline"}>{t("Select this package")}</ButtonLink></article>)}
        </div>
        <div className="comparison-wrap" id="package-comparison">
          <h3>{t("Compare the foundations.")}</h3>
          <table aria-label={t("Package comparison")}><thead><tr><th>{t("Includes")}</th>{localizedPackages.map((pkg) => <th key={pkg.name}>{pkg.name}</th>)}</tr></thead><tbody>{localizedRows.map((row) => <tr key={row[0]}><th>{row[0]}</th>{row.slice(1).map((cell, index) => <td key={`${row[0]}-${index}`}>{cell}</td>)}</tr>)}</tbody></table>
        </div>
        <div className="package-terms"><h3>{t("Notes")}</h3>{localizedTerms.map(([title, body]) => <article key={title}><strong>{title}</strong><p>{body}</p></article>)}</div>
      </section>
      <section className="section connected-presence">
        <div><p className="eyebrow">{t("Connected Presence")}</p><h2>{t("Google and social profiles, connected.")}</h2><p>{c.connectedPresence.summary}</p></div>
        <div className="connected-presence-details"><strong>{c.connectedPresence.price}</strong><ul>{c.connectedPresence.bullets.map((bullet) => <li key={bullet}><Check size={15} />{bullet}</li>)}</ul><small>{t("Google controls Business Profile approval and verification. Monthly posting, photography, video production and advertising are not included.")}</small></div>
      </section>
      <section className="section addons-section">
        <SectionTitle eyebrow={t("Optional services")} title={t("Add only what your business needs.")} body={t("Add-ons are priced separately from the selected package and require approval before work begins.")} />
        <div className="addon-grid">{c.websiteAddons.map(([name, price]) => <article key={name}><h3>{name}</h3><strong>{price}</strong></article>)}</div>
        <div className="source-code-transfer"><strong>{t("Source-code transfer")}</strong><p>{c.sourceCodeTransfer.price}</p><small>{c.sourceCodeTransfer.note}</small></div>
      </section>
      <Process locale={locale} section="services" title="How we work together." />
      <section className="assurance-band"><p>{t("What every engagement includes")}</p>{localizedAssurances.map(([Icon, label, body]) => <div key={label}><Icon /><h3>{label}</h3><span>{body}</span></div>)}</section>
      <Faq
        title={t("Before we begin.")}
        questions={localize(locale, "services", ["How long does a typical project take?", "Do you provide content and photography?", "Can I upgrade to a larger package later?", "What if I already have a website or domain?"])}
        answers={localize(locale, "services", [
          "A typical project takes 14 days after the design is confirmed.",
          "Yes. Content and photography support are available through the Content Planning add-on.",
          "Yes. You can upgrade to a larger package later as your content, features, or support needs grow.",
          "We also provide website renovation services. We can assess your current website or domain and recommend what can be retained, improved, or rebuilt.",
        ])}
      />
      <ConsultationBand locale={locale} title={t("Start with the right foundation.")} />
    </>
  );
}

function JournalPage({ locale }: { locale: Locale }) {
  const t = (value: string) => translate(locale, "journal", value);
  const [featuredArticle, ...latestArticles] = getArticles(locale);
  const localizedTopics = localize(locale, "journal", topicItems);

  return (
    <>
      <section className="section featured-journal">
        <SectionTitle as="h1" eyebrow={t("Journal")} title={t("Online presence is business infrastructure.")} />
        {featuredArticle && <div className="featured-journal-grid"><img src={featuredArticle.image} alt={featuredArticle.imageAlt} /><article><p className="eyebrow">{featuredArticle.category}</p><h2>{featuredArticle.title}{locale === "my" ? "။" : "."}</h2><p>{featuredArticle.summary}</p><Link to={`/journal/${featuredArticle.slug}`}>{t("Read article")} <ArrowRight /></Link></article><ol><li><b>01</b> {t("Visibility before contact")}</li><li><b>02</b> {t("Google profile trust")}</li><li><b>03</b> {t("Business email credibility")}</li></ol></div>}
      </section>
      <section className="section latest-notes"><SectionTitle eyebrow={t("Latest notes")} title={t("Practical guidance, without the jargon.")} /><div className="journal-grid">{latestArticles.map((article) => <article key={article.slug}><img src={article.image} alt={article.imageAlt} /><p className="eyebrow">{article.category}</p><h3>{article.title}</h3><small>{article.readTime}</small><Link to={`/journal/${article.slug}`}>{t("Read article")} <ArrowRight size={14} /></Link></article>)}</div></section>
      <blockquote className="journal-quote">{t("“Being visible is not about being everywhere. It is about being clear where customers already look.”")}<span>{t("Yi Digital note 01")}</span></blockquote>
      <section className="section topic-index"><SectionTitle title={t("Explore by business need.")} /><div className="topic-grid">{localizedTopics.map(([Icon, title, links]) => <article key={title}><Icon /><h3>{title}</h3>{links.filter(link => getArticles(locale).some(article => article.slug === link.slug)).map((link) => <Link to={`/journal/${link.slug}`} key={link.label}>{link.label}<ArrowRight size={13} /></Link>)}</article>)}</div></section>
      <section className="journal-consult"><img src={images.servicesConsultation} alt={t("Consultation for an online business launch")} /><div><h2>{t("Need more than an article?")}</h2><p>{t("Every business is different. Let us talk about your goals and build a simple plan that makes sense for you.")}</p><ButtonLink tone="outline">{copy[locale].global.consultation}</ButtonLink></div></section>
    </>
  );
}

function JournalArticlePage({ locale }: { locale: Locale }) {
  const t = (value: string) => translate(locale, "journal", value);
  const { slug } = useParams();
  const article = (getArticles(locale)).find((item) => item.slug === slug);

  if (!article) return <NotFoundPage locale={locale} />;

  return (
    <article className="journal-article">
      <header className="journal-article-hero">
        <div className="journal-article-heading">
          <Link className="article-breadcrumb" to="/journal">{t("Journal")} <ArrowRight size={13} /></Link>
          <p className="eyebrow">{article.category}</p>
          <h1>{article.title}{locale === "my" ? "။" : "."}</h1>
          <p className="journal-article-summary">{article.summary}</p>
          <small>{article.readTime} · {t("Practical guidance for local businesses")}</small>
        </div>
        <img src={article.image} alt={article.imageAlt} />
      </header>

      <div className="journal-article-layout">
        <div className="journal-article-body">
          <p className="article-lead">{article.intro}</p>
          {article.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
          <section className="article-checklist">
            <p className="eyebrow">{t("A useful place to start")}</p>
            <h2>{t("Your practical checklist.")}</h2>
            <ul>{article.checklist.map((item) => <li key={item}><Check size={17} />{item}</li>)}</ul>
          </section>
          <p className="article-closing">{article.closing}</p>
        </div>

        <aside className="article-aside">
          <p className="eyebrow">{t("Need a clear plan?")}</p>
          <h2>{t("Turn the ideas into a practical next step.")}</h2>
          <p>{t("We can review what your business already has, identify what matters most, and build a focused online foundation.")}</p>
          <ButtonLink tone="outline">{copy[locale].global.consultation}</ButtonLink>
          <Link className="back-to-journal" to="/journal"><ArrowRight size={14} /> {t("Back to all journal articles")}</Link>
        </aside>
      </div>
    </article>
  );
}


function ProjectPreview({ websitePreview, image, alt, hint, mobileLabel, url }: { websitePreview: boolean; image: string; alt: string; hint: string; mobileLabel: string; url?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!websitePreview || typeof window.matchMedia !== "function") return;
    const narrowViewport = window.matchMedia("(max-width: 820px)");
    const resetPreview = (event?: MediaQueryListEvent) => {
      if ((event?.matches ?? narrowViewport.matches) && scrollRef.current) scrollRef.current.scrollTop = 0;
    };

    resetPreview();
    narrowViewport.addEventListener("change", resetPreview);
    return () => narrowViewport.removeEventListener("change", resetPreview);
  }, [websitePreview]);

  if (!websitePreview) return <img src={image} alt="" />;
  return <>
    <div className="project-preview-scroll" ref={scrollRef} role="region" tabIndex={0} aria-label={alt}><img src={image} alt={alt} /></div>
    <div className="project-preview-cue" aria-hidden="true"><span>{hint}</span><b>↓</b></div>
    {url ? <a className="project-preview-mobile-link" href={url} target="_blank" rel="noreferrer">{mobileLabel}<ExternalLink size={14} /></a> : null}
  </>;
}

function OurWorkPage({ locale }: { locale: Locale }) {
  const t = (value: string) => translate(locale, "previousWork", value);
  const localizedWork = getWork(locale);
  return (
    <>
      <section className="section project-showcase"><SectionTitle as="h1" eyebrow={t("Selected projects")} title={t("What each customer chose—and what it made possible.")} body={t("Explore the packages and add-ons selected for each project. Performance figures remain private.")} /><div className="project-case-list">{localizedWork.map((project, index) => <article className={index === 0 ? "project-case project-case-featured" : "project-case"} key={project.title}><div className={project.websitePreview ? "project-case-media is-website-preview" : "project-case-media"}><ProjectPreview websitePreview={project.websitePreview} image={project.scrollImage ?? project.image} alt={`${project.title} ${t("scrolling website preview")}`} hint={t("Scroll to explore website")} mobileLabel={t("View full website")} url={project.url} /></div><div className="project-case-story"><p className="eyebrow">{project.type}</p><h2>{project.title}</h2><p>{project.summary}</p><div className="project-package"><span>{t("Package selected")}</span><strong>{project.packageName}</strong><Link to="/services">{t("View package")} <ArrowRight size={14} /></Link></div><div className="project-detail-grid"><div><h3>{t("Add-ons & extras")}</h3><ul className="addon-tags">{project.addons.map((addon) => <li key={addon}><Sparkles size={13} />{addon}</li>)}</ul></div><div><h3>{t("What we delivered")}</h3><ul className="delivery-list">{project.delivered.map((item) => <li key={item}><Check size={14} />{item}</li>)}</ul></div></div><div className="project-outcome"><span>{t("Project outcome")}</span><p>{project.outcome}</p></div>{project.url ? <a className="project-live-link" href={project.url} target="_blank" rel="noreferrer">{t("Visit live website")}<ExternalLink size={15} /></a> : null}</div></article>)}</div></section>
      <section className="package-reference"><div><p className="eyebrow">{t("The right scope, visibly explained")}</p><h2>{t("Every project starts with a package. Add-ons make it fit.")}</h2></div><div><p>{t("The package sets the website’s core structure, support, and capability. Add-ons cover the extra content, languages, connected presence, or custom touches the customer needs.")}</p><ButtonLink tone="gold" to="/services#package-comparison">{t("Compare packages and add-ons")}</ButtonLink></div></section>
      <section className="work-cta"><img src={images.contactPlanning} alt={t("Planning a new online project")} /><div><p className="eyebrow">{t("Your project")}</p><h2>{t("Let’s build the next one together.")}</h2><p>{t("Tell us what your business needs. We’ll recommend a focused foundation and a clear path from idea to launch.")}</p><ButtonLink tone="outline">{copy[locale].global.consultation}</ButtonLink></div></section>
    </>
  );
}

function Faq({ title, questions, answers }: { title: string; questions: string[]; answers?: string[] }) {
  return <section className="section faq-section"><SectionTitle title={title} /><div>{questions.map((question, index) => <details key={question}><summary>{question}<span>+</span></summary><p>{answers?.[index] ?? "We will confirm the details during a calm consultation and recommend the clearest next step for your business."}</p></details>)}</div></section>;
}

function ContactPage({ locale }: { locale: Locale }) {
  const t = (value: string) => translate(locale, "contact", value);
  const [searchParams] = useSearchParams();
  const requestedPackage = searchParams.get("package");
  const selectedPackage = requestedPackage && packages.some((pkg) => pkg.name === requestedPackage) ? requestedPackage : "";
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [token, setToken] = useState("");
  const [verificationError, setVerificationError] = useState(false);
  const [verificationKey, setVerificationKey] = useState(0);
  const requestInFlight = useRef(false);
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (status === "success") confirmationDialog.current?.showModal();
  }, [status]);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    if (!token) { setVerificationError(true); setStatus("error"); return; }
    const form = event.currentTarget;
    requestInFlight.current = true;
    setStatus("sending");
    setVerificationError(false);
    try {
      const response = await fetch("/api/contact", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), token }),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) {
        setVerificationError(result.error === "Verification failed");
        throw new Error("Submission failed");
      }
      setStatus("success");
      form.reset();
    } catch { setStatus("error"); }
    finally {
      requestInFlight.current = false;
      setToken("");
      setVerificationKey(value => value + 1);
    }
  }
  const address = business.address;
  const contactRoutes = [
    { Icon: Phone, label: "Phone", detail: business.phone, href: `tel:${business.phoneNumber}` },
    { Icon: Mail, label: "Email", detail: business.email, href: `mailto:${business.email}` },
    { Icon: MessageCircle, label: "Viber", detail: business.phone, href: `viber://chat?number=${encodeURIComponent(business.viberNumber)}` },
    { Icon: MapPin, label: "Google Maps", detail: address, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` },
  ];
  const nextSteps = localize(locale, "contact", [["01", "We review your needs", "We look at your goals, timing, and current online setup."], ["02", "We recommend a foundation", "We suggest the package that best fits your priorities and budget."], ["03", "We arrange the consultation", "We confirm the channel, time, and checklist for the conversation."]] as const);
  const reassuranceItems = localize(locale, "contact", [[Search, "Clear questions", "We focus on your goals, customers, and current gaps."], [ShieldCheck, "Honest recommendation", "We suggest only what is useful for your business right now."], [Compass, "No technical pressure", "Every option is explained clearly and in plain language."]] as const);
  return (
    <>
      <section className="section contact-main">
        <nav className="mobile-contact-options" aria-label={t("Quick contact")}>
          <p>{t("Prefer to talk directly?")}</p>
          <div>{contactRoutes.filter(({ label }) => label === "Phone" || label === "Viber").map(({ Icon, label, href }) => <a className="button button-outline" href={href} key={label}><Icon size={18} />{t(label)}</a>)}</div>
        </nav>
        <form id="contact-form" onSubmit={handleSubmit} aria-busy={status === "sending"}>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ display: "none" }} />
          <p className="eyebrow">{t("Consultation")}</p>
          <h1>{t("Tell us about your business.")}</h1>
          <p className="contact-intro">{t("Share a few essentials and we’ll recommend a practical next step. You do not need to choose a package before getting in touch.")}</p>
          <p className="form-guidance">{t("Fields marked * are required.")}</p>
          <div className="form-grid">
            <label><span>{t("Name")} <small className="field-required" aria-hidden="true">*</small></span><input autoComplete="name" name="name" required maxLength={120} /></label>
            <label><span>{t("Business name")} <small className="field-optional">({t("optional")})</small></span><input autoComplete="organization" name="businessName" /></label>
            <label><span>{t("Email")} <small className="field-required" aria-hidden="true">*</small></span><input autoComplete="email" inputMode="email" name="email" type="email" required maxLength={254} /></label>
            <label><span>{t("Phone number")} <small className="field-required" aria-hidden="true">*</small></span><input autoComplete="tel" inputMode="tel" name="phone" type="tel" required maxLength={60} /></label>
            <label><span>{t("Package interest")} <small className="field-optional">({t("optional")})</small></span><select defaultValue={selectedPackage} key={selectedPackage || "no-package"} name="packageInterest"><option value="" disabled>{t("Select one")}</option><option>{t("Not sure yet")}</option>{packages.map((pkg, index) => <option key={index} value={pkg.name}>{copy[locale].services.packages.options[index].name}</option>)}</select></label>
            <label><span>{t("Ideal launch timing")} <small className="field-optional">({t("optional")})</small></span><select defaultValue="" name="launchTiming"><option value="" disabled>{t("Select one")}</option><option>{t("As soon as possible")}</option><option>{t("Within 1 month")}</option><option>{t("Within 1–3 months")}</option><option>{t("Just exploring")}</option></select></label>
          </div>
          <label><span>{t("Short message")} <small className="field-required" aria-hidden="true">*</small></span><textarea name="message" required maxLength={5000} placeholder={t("Tell us about your business and what you hope to achieve.")} /></label>
          <p className="privacy"><ShieldCheck size={17} /> {t("Your details are used only to respond to your enquiry.")}</p>
          <ContactVerification onToken={setToken} resetKey={verificationKey} />
          <button className="button button-gold" type="submit" disabled={status === "sending"}>{status === "sending" ? (interfaceText(locale, "Sending…")) : t("Request a consultation")}</button>
          <dialog ref={confirmationDialog} className="contact-success-dialog" aria-labelledby="contact-success-title" aria-describedby="contact-success-message" onClose={() => setStatus("idle")} onClick={event => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
          }}>
            <div className="contact-success-icon"><Check aria-hidden="true" /></div>
            <h2 id="contact-success-title">{interfaceText(locale, "Thank you.")}</h2>
            <p id="contact-success-message">{interfaceText(locale, "Your enquiry has been submitted. We’ll contact you soon. Please check your inbox for a confirmation email.")}</p>
            <button className="button button-gold" type="button" autoFocus onClick={() => confirmationDialog.current?.close()}>{interfaceText(locale, "Close")}</button>
          </dialog>
          {status === "error" && <p role="alert">{locale === "my" ? (verificationError ? "လုံခြုံရေးစစ်ဆေးမှုကို ပြီးစီးပြီး ပြန်လည်ပေးပို့ပါ သို့မဟုတ် အီးမေးလ်ပို့ပါ — " : "အီးမေးလ်ဝန်ဆောင်မှု မရရှိနိုင်သောကြောင့် ပေးပို့မှုကို အတည်မပြုနိုင်ပါ။ နောက်မှ ပြန်လည်ကြိုးစားပါ သို့မဟုတ် အီးမေးလ်ပို့ပါ — ") : (verificationError ? "Please complete the verification checkbox, then submit again. You can also email us at " : "We couldn’t confirm your submission because the email service is unavailable. Your details are still here. Please try again later or email us at ")}<a href={`mailto:${business.email}`}>{business.email}</a>.</p>}
        </form>
        <aside><h2>{t("How we can connect.")}</h2><p>{t("Choose the route that feels easiest. We’ll confirm the details before the conversation.")}</p>{contactRoutes.map(({ Icon, label, detail, href }) => <div key={label}><Icon aria-hidden="true" /><span><strong>{t(label)}</strong><small>{href ? <a href={href}>{detail}</a> : detail}</small></span></div>)}</aside>
      </section>
      <section className="section next-steps"><SectionTitle title={t("What happens next.")} /><div>{nextSteps.map(([number, title, body]) => <article key={number}><b>{number}</b><div><h3>{title}</h3><p>{body}</p></div></article>)}</div></section>
      <section className="reassurance"><h2>{t("A useful first conversation, not a sales performance.")}</h2>{reassuranceItems.map(([Icon, title, body]) => <div key={title as string}><Icon /><span><strong>{title as string}</strong><small>{body as string}</small></span></div>)}</section>
      <section className="preparation"><div><h2>{t("A few things worth bringing.")}</h2><p>{t("Having these ready helps us make the most of our time together.")}</p><ul>{localize(locale, "contact", ["Current website or pages", "Existing domain & email", "Company profile", "Contact details", "Business name and location", "Ideal launch timing"]).map((item) => <li key={item}><Check />{item}</li>)}</ul></div><img src={images.contactPlanning} alt={t("Planning materials for a consultation")} /></section>
      <Faq
        title={t("Before you send.")}
        questions={localize(locale, "contact", ["Do I need to choose a package first?", "What happens after I submit the form?", "What if I already have a website or domain?", "How soon can a project begin?"])}
        answers={localize(locale, "contact", [
          "No. We’ll guide you towards the package that best fits your current needs, priorities, and budget.",
          "We’ll review the details you share and contact you through your preferred channel to arrange the next conversation.",
          "Bring the details for your existing website, domain, and hosting. We’ll review the current setup and recommend how to update or improve its hosting structure.",
          "We’ll provide a project checklist first. Once everything on it is ready, we’ll meet to confirm the plan and begin the design work.",
        ])}
      />
      <section className="alternate-cta"><Sparkles /><div><h2>{t("Not ready to enquire yet?")}</h2><p>{t("Explore ideas and practical guidance that may help shape your plan.")}</p></div><ButtonLink tone="outline" to="/services">{t("Explore services")}</ButtonLink><ButtonLink tone="outline" to="/journal">{t("Read the journal")}</ButtonLink></section>
    </>
  );
}

function NotFoundPage({ locale }: { locale: Locale }) {
  return <section className="section not-found">
    <SectionTitle as="h1" eyebrow="404" title={interfaceText(locale, "Page not found.")}
      body={interfaceText(locale, "This link may be incorrect, or the page may have moved. Return home or contact us for help.")} />
    <div className="not-found-actions">
      <ButtonLink to="/" tone="gold">{interfaceText(locale, "Back to home")}</ButtonLink>
      <ButtonLink to="/contact" tone="outline">{interfaceText(locale, "Contact us")}</ButtonLink>
    </div>
  </section>;
}

export function PageRoutes({ locale }: { locale: Locale }) {
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  useEntryAnimations(main, location.pathname);

  return (
    <main key={location.pathname} ref={main}>
      <PageMetadata locale={locale} />
      <Routes location={location}>
        <Route path="/" element={<HomePage locale={locale} />} />
        <Route path="/services" element={<ServicesPage locale={locale} />} />
        <Route path="/motion" element={<Suspense fallback={<section className="section" role="status">{interfaceText(locale, "Loading animation…")}</section>}><AnimationShowcasePage locale={locale} /></Suspense>} />
        <Route path="/journal" element={<JournalPage locale={locale} />} />
        <Route path="/journal/:slug" element={<JournalArticlePage locale={locale} />} />
        <Route path="/our-work" element={<OurWorkPage locale={locale} />} />
        <Route path="/previous-work" element={<Navigate replace to="/our-work" />} />
        <Route path="/contact" element={<ContactPage locale={locale} />} />
        <Route path="*" element={<NotFoundPage locale={locale} />} />
      </Routes>
    </main>
  );
}
