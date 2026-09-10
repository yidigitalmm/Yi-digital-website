import { animationCopy, getMedia } from "./cms/siteContent";
import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { Locale } from "./content";

export function InstantCameraShowcase({ locale }: { locale: Locale }) {
  const c = animationCopy[locale].camera;
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<{ shoot: () => void; reset: () => void; explore: () => void; dispose: () => void } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "developing" | "ready" | "error">("loading");
  const [exploded, setExploded] = useState(false);
  const [part, setPart] = useState("");
  const [active, setActive] = useState(false);
  const reducedMotion = Boolean(useReducedMotion());

  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setActive(true); observer.disconnect(); }
    }, { rootMargin: "250px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active || !host.current) return;
    let disposed = false;
    setStatus("loading");
    import("./instantCameraScene").then(({ mountInstantCamera }) => {
      if (disposed || !host.current) return;
      controller.current = mountInstantCamera(host.current, {
        reducedMotion,
        onStatus: setStatus,
        onExplore: setExploded,
        onPart: setPart,
        onPhoto: () => dialog.current?.showModal(),
      });
    }).catch(() => { if (!disposed) { host.current?.replaceChildren(); setStatus("error"); } });
    return () => { disposed = true; controller.current?.dispose(); controller.current = null; };
  }, [active, reducedMotion]);

  return (
    <section className="instant-camera-section" aria-labelledby="instant-camera-title">
      <div className="instant-camera-copy">
        <p className="eyebrow">{c.label}</p>
        <h2 id="instant-camera-title">{c.title}</h2>
        <p>{c.body}</p>
        <button className="instant-shutter" type="button" disabled={status === "loading" || status === "error" || status === "developing"} onClick={() => controller.current?.shoot()}>
          <Camera size={20} /><span>{status === "ready" ? c.again : c.shoot}</span><i aria-hidden="true" />
        </button>
        <p className="instant-status" role="status">{status === "developing" ? c.developing : status === "ready" ? c.ready : status === "loading" ? c.loading : status === "error" ? c.fallback : ""}</p>
        <div className="instant-uses motion-uses"><small>{c.uses}</small><div>{c.tags.map(tag => <span key={tag}>{tag}</span>)}</div></div>
      </div>
      <div className="instant-camera-stage">
        <div className="instant-camera-canvas" ref={host} role="group" aria-label={c.drag} tabIndex={0} />
        {(status === "loading" || status === "error") && <img className="instant-camera-poster" src={getMedia("cameraPoster", "/images/generated/instant-camera-reference.png")} alt="" />}
        <button className="instant-explore" type="button" aria-pressed={exploded} disabled={status === "loading" || status === "error" || status === "developing"} onClick={() => controller.current?.explore()}>{exploded ? c.assemble : c.explore}</button>
        {part && locale === "en" && <span className="instant-part" role="status">{part}</span>}
        <div className="instant-stage-footer"><span>{c.drag}</span><button type="button" onClick={() => controller.current?.reset()} aria-label={c.reset}><RotateCcw size={18} /></button></div>
        {status === "ready" && <button className="instant-photo-open" aria-label={c.photo} type="button" onClick={() => dialog.current?.showModal()}>{c.photo} ↗</button>}
      </div>
      <dialog ref={dialog} aria-label={c.photo} className="instant-photo-dialog" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
        <button className="instant-photo-close" type="button" aria-label={c.close} onClick={() => dialog.current?.close()}><X /></button>
        <figure><img src={getMedia("cafeCounter", "/images/generated/cafe-counter.webp")} alt={c.caption} /><figcaption>{c.caption}<small>{c.signature}</small></figcaption></figure>
      </dialog>
    </section>
  );
}
