import { animationCopy, getMedia } from "./cms/siteContent";
import { useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  RotateCcw,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import { type Locale } from "./content";
import { InstantCameraShowcase } from "./InstantCameraShowcase";
import { NanotechRevealCanvas } from "./NanotechRevealCanvas";


const startEndVideos = [
  { src: "/videos/start-end/burger-build-transparent.webm", type: "video/webm", fallback: "/videos/start-end/burger-build.mp4", poster: getMedia("motionLayeredPoster", "/videos/start-end/burger-build-transparent-poster.png"), format: "portrait", theme: "burger" },
  { src: "/videos/start-end/blind-box-reveal-transparent.webm", type: "video/webm", fallback: "/videos/start-end/blind-box-reveal-fallback.mp4", poster: getMedia("motionSurprisePoster", "/videos/start-end/blind-box-reveal-transparent-poster.png"), format: "portrait", theme: "blindbox" },
  { src: "/videos/start-end/kitchen-build.mp4", type: "video/mp4", fallback: null, poster: getMedia("motionTransformationPoster", "/videos/start-end/kitchen-build-poster.jpg"), format: "wide", theme: "kitchen" },
] as const;

function StartEndShowcase({ locale }: { locale: Locale }) {
  const c = animationCopy[locale].motion;
  const [activeIndex, setActiveIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const selectionChanged = useRef(false);
  const tabDrag = useRef<{ id: number; x: number; scroll: number; moved: boolean } | null>(null);
  const [videoVisible, setVideoVisible] = useState(false);
  useEffect(() => {
    if (!sectionRef.current) return;
    const observer = new IntersectionObserver(([entry]) => setVideoVisible(entry.isIntersecting));
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);
  const reduceMotion = useReducedMotion();
  const active = c.items[activeIndex];
  const media = startEndVideos[activeIndex];
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (videoVisible && !reduceMotion) void video.play().catch(() => undefined);
    else if (!video.paused) video.pause();
  }, [videoVisible, reduceMotion, activeIndex]);

  useEffect(() => {
    if (!selectionChanged.current) return;
    selectionChanged.current = false;
    if (window.innerWidth > 820) return;
    const frame = requestAnimationFrame(() => {
      const display = mediaRef.current;
      if (!display) return;
      const bounds = display.getBoundingClientRect();
      const headerBottom = document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
      if (bounds.top < headerBottom + 16 || bounds.bottom > window.innerHeight - 16) {
        display.scrollIntoView({ behavior: reduceMotion ? "instant" : "smooth", block: "center" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, reduceMotion]);

  const selectAnimation = (index: number) => {
    if (index === activeIndex) return;
    selectionChanged.current = true;
    setActiveIndex(index);
  };

  const replay = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    void videoRef.current.play();
  };

  return (
    <section ref={sectionRef} className="start-end-section" aria-labelledby="start-end-title">
      <header className="start-end-heading">
        <h2 id="start-end-title">{c.title}</h2>
        <p>{c.intro}</p>
      </header>

      <div className={`start-end-feature theme-${media.theme} format-${media.format}`}>
        <div className="start-end-web-canvas">
          <article
            aria-labelledby={`start-end-tab-${activeIndex}`}
            aria-live="polite"
            className="start-end-story"
            id="start-end-panel"
            role="tabpanel"
          >
            <p className="eyebrow">{active.type}</p>
            <h3>{active.title}</h3>
            <p>{active.body}</p>
          </article>
          <div ref={mediaRef} className={`start-end-media is-${media.format}`}>
            <div className="start-end-orbit" aria-hidden="true"><i /><i /><i /></div>
            <video
              autoPlay={videoVisible && !reduceMotion}
              key={media.src}
              loop
              muted
              playsInline
              poster={media.poster}
              preload="none"
              ref={videoRef}
            >
              <source src={media.src} type={media.type} />
              {media.fallback ? <source src={media.fallback} type="video/mp4" /> : null}
            </video>
            <button aria-label={c.replay} className="start-end-replay" onClick={replay} type="button"><RotateCcw /></button>
          </div>
        </div>
      </div>

      <div className="start-end-selector">
        <small>{c.choose}</small>
        <div aria-label={c.choose} role="tablist"
          onPointerDown={(event) => {
            tabDrag.current = null;
            if (window.innerWidth > 820 || event.pointerType !== "mouse" || event.button !== 0) return;
            tabDrag.current = { id: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
          }}
          onPointerMove={(event) => {
            const drag = tabDrag.current;
            if (!drag || drag.id !== event.pointerId || event.buttons !== 1) return;
            const distance = event.clientX - drag.x;
            if (Math.abs(distance) > 6) {
              drag.moved = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }
            if (drag.moved) { event.preventDefault(); event.currentTarget.scrollLeft = drag.scroll - distance; }
          }}
          onPointerUp={(event) => {
            if (tabDrag.current?.moved && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { tabDrag.current = null; }}
          onClickCapture={(event) => {
            if (tabDrag.current?.moved && event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
            tabDrag.current = null;
          }}
        >
          {c.items.map((item, index) => (
            <button
              aria-controls="start-end-panel"
              aria-selected={activeIndex === index}
              className={activeIndex === index ? "is-active" : undefined}
              id={`start-end-tab-${index}`}
              key={item.label}
              onClick={() => selectAnimation(index)}
              role="tab"
              type="button"
            >
              <span>0{index + 1}</span><strong>{item.label}</strong><i />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AnimationShowcasePage({ locale }: { locale: Locale }) {
  const [revealEnabled, setRevealEnabled] = useState(false);
  const c = animationCopy[locale].reveal;
  const section = c.sections[0];
  const reduceMotion = useReducedMotion();


  return (
    <div className="motion-showcase-page">
      <div className="motion-sections">
        <section className="identity-reveal-section">
          <div
            className="identity-reveal-stage"
            onPointerEnter={() => setRevealEnabled(true)}
            onPointerDown={() => setRevealEnabled(true)}
            onFocus={() => setRevealEnabled(true)}
            role="group"
            aria-label={`${section.cue}. ${c.touchInteraction}`}
            tabIndex={0}
          >
            <div className="identity-reveal-visual">
              <div className="identity-reveal-grid" aria-hidden="true" />
              <img className="identity-layer identity-android-layer" src={getMedia("revealArmor", "/images/generated/android-black-gold-powered-armor-cropped.webp")} alt="" />
              {revealEnabled && <NanotechRevealCanvas reducedMotion={Boolean(reduceMotion)} />}
            </div>
            <div className="identity-copy">
              <div className="identity-copy-main">
                <p className="eyebrow">{section.type}</p>
                <h1>{section.title}</h1>
                <p>{section.body}</p>
              </div>
              <div className="identity-copy-details">
                <div className="identity-cue"><MousePointer2 /><span><small>{c.interaction}</small><span className="identity-cue-pointer">{section.cue}</span><span className="identity-cue-touch">{c.touchInteraction}</span></span></div>
                <div className="motion-uses"><small>{c.uses}</small><div>{section.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
              </div>
            </div>
          </div>
        </section>
        <StartEndShowcase locale={locale} />
        <InstantCameraShowcase locale={locale} />
      </div>
    </div>
  );
}
