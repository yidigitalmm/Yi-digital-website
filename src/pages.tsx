import { editorialText } from './cms/editorialText';
import { HomeTransformation } from "./HomeTransformation";
import { ServicePackages } from "./ServicePackages";
import { serviceOffering } from "./serviceOffering";
import { optimizedImage } from "./optimizedImages";
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
  FileText,
  ShoppingBag,
  WandSparkles,
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
  const l = (en: string, my: string) => editorialText('home-services', locale, en, my);
  const offering = serviceOffering(locale);
  const serviceIcons = [Globe2, ShoppingBag, FileText, WandSparkles, MessageCircle];
  const homeServices = [
    [l('Business websites','လုပ်ငန်း ဝဘ်ဆိုက်များ'), l("Single page {singlePrice} · Up to 8 pages {businessPrice}","စာမျက်နှာတစ်ခု {singlePrice} · ၈ မျက်နှာအထိ {businessPrice}").replace("{singlePrice}", offering.options[0].price).replace("{businessPrice}", offering.options[1].price), 'packages'],
    [l('E-commerce, booking & loyalty','အွန်လိုင်းအရောင်း၊ booking နှင့် loyalty'), l('Website system add-ons · US$250–450','ဝဘ်ဆိုက်စနစ် ထပ်တိုးမှု · US$250–450'), 'system-addons'],
    [l('Company profiles & catalogs','ကုမ္ပဏီပရိုဖိုင်နှင့် ကတ်တလောက်'), l('PDF documents · US$75 each · Additional language US$25','PDF စာရွက်စာတမ်း · တစ်ခု US$75 · ထပ်တိုးဘာသာ US$25'), 'pdf-services'],
    [l('Languages, animation & CMS','ဘာသာစကား၊ animation နှင့် CMS'), l('Translation, custom scroll animation and content editing.','ဘာသာပြန်၊ စိတ်ကြိုက် scroll animation နှင့် အကြောင်းအရာပြင်ဆင်မှု။'), 'addons'],
    [l('Google, social & invitations','Google၊ လူမှုကွန်ရက်နှင့် ဖိတ်စာများ'), l('Profile setup US$125 · Digital invitations US$25–75','ပရိုဖိုင်တည်ဆောက်မှု US$125 · ဒစ်ဂျစ်တယ်ဖိတ်စာ US$25–75'), 'more-services'],
  ];
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
        {c.capabilities.map(([name, detail], index) => { const Icon = capabilityIcons[index]; return <div key={name}><Icon aria-hidden="true" focusable="false" /><span><strong>{name}</strong><small>{detail}</small></span></div>; })}
      </section>

      <HomeTransformation locale={locale} />

      <section className="section service-list-section">
        <SectionTitle eyebrow={c.servicesEyebrow} title={c.servicesTitle} body={l("Websites, business systems and digital documents. Choose a starting point; add what you need.","ဝဘ်ဆိုက်၊ လုပ်ငန်းသုံးစနစ်နှင့် ဒစ်ဂျစ်တယ်စာရွက်စာတမ်းများ။ အခြေခံပက်ကေ့ချ်မှစ၍ လိုအပ်သည်များကို ထပ်တိုးနိုင်ပါသည်။")} />
        <div className="home-service-tiles">
          {homeServices.map(([name, body, anchor], index) => { const Icon = serviceIcons[index]; return <Link to={"/services#"+anchor} key={name}><Icon className="service-tile-icon" aria-hidden="true"/><h3>{name}</h3><p>{body}</p><ArrowRight className="service-tile-arrow" aria-hidden="true"/></Link>; })}
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
          {getArticles(locale).slice(0, 3).map((article) => <article key={article.slug}><img {...optimizedImage(article.image)} sizes="(max-width: 700px) 85vw, 400px" loading="lazy" decoding="async" alt={article.imageAlt} /><h3>{article.title}</h3><p>{article.summary}</p><Link to={`/journal/${article.slug}`}>{c.readArticle} <ArrowRight size={14} /></Link></article>)}
        </div>
      </section>
      <ConsultationBand locale={locale} />
    </>
  );
}

function ServicesPage({ locale }: { locale: Locale }) {
  const t = (value: string) => translate(locale, "services", value);
  const localizedAssurances = localize(locale, "services", assuranceItems);
  return (
    <>
      <ServicesHero locale={locale} />
      <ServicePackages locale={locale} />
      <Process locale={locale} section="services" title="How we work together." />
      <section className="assurance-band"><p>{t("What every engagement includes")}</p>{localizedAssurances.map(([Icon, label, body]) => <div key={label}><Icon /><h3>{label}</h3><span>{body}</span></div>)}</section>
      <Faq
        title={t("Before we begin.")}
        questions={localize(locale, "services", ["What is included in the website price?", "What will I pay each year?", "Do you work with businesses outside Yangon?", "How long does a typical project take?", "Do you provide content and photography?", "Can I upgrade to a larger package later?", "What if I already have a website or domain?"])}
        answers={localize(locale, "services", [
          "Website packages include hosting for simple Cloudflare-hosted websites, standard SSL, first-year standard domain registration below US$20, 3 design revision rounds, 3 implementation reviews and 30 days post-launch support. Additional resources and higher-priced domains are charged separately.",
          "Annual maintenance is 30% of the project price, starting on the subscription date. It includes one data-update request per month, with unused requests expiring at the end of each calendar month and no rollover, excluding design and layout changes. Additional resource costs are separate.",
          "Yes. Yi Digital works with businesses across Myanmar. Tell us where your business is based and what you need, and we’ll agree on the scope and how to work together during your consultation.",
          "The first website implementation is delivered within 14 days after the design is confirmed.",
          "Content preparation is included in the website package. Photography requirements are agreed separately.",
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
  const offeredPackages = serviceOffering("en").options;
  const selectedPackage = requestedPackage && offeredPackages.some((pkg) => pkg.name === requestedPackage) ? requestedPackage : "";
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
      try {
        const analytics = window as Window & { gtag?: (...args: unknown[]) => void };
        analytics.gtag?.("event", "generate_lead", { form_name: "contact_enquiry" });
      } catch {
        // Analytics must never turn a successful enquiry into a submission error.
      }
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
            <label><span>{t("Package interest")} <small className="field-optional">({t("optional")})</small></span><select defaultValue={selectedPackage} key={selectedPackage || "no-package"} name="packageInterest"><option value="" disabled>{t("Select one")}</option><option>{t("Not sure yet")}</option>{offeredPackages.map((pkg, index) => <option key={index} value={pkg.name}>{serviceOffering(locale).options[index].name}</option>)}</select></label>
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
