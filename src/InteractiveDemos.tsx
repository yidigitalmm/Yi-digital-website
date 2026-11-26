import { useBufferedVideo } from './useBufferedVideo';
import { getMedia } from './cms/siteContent';
import { editorialText } from './cms/editorialText';
import { useEffect, useRef, useState } from 'react';
import { RotateCcw, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import type { Locale } from './content';

/** Wheel scrubbing is confined to the media frame; the rest of the page scrolls normally. */
export function InteractiveDemos({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  const l = (en: string, my: string) => editorialText('tea', locale, en, my);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const buffered = useBufferedVideo(getMedia("teaJourneyVideo", "/videos/start-end/tea-journey-web-v2.mp4"), stage);
  const requestedTime = useRef(0);
  const progressRef = useRef(progress);
  const wheelFrame = useRef<number | null>(null);
  const updateProgress = (next: number) => { progressRef.current = next; setProgress(next); };
  const reduceMotion = useReducedMotion();
  const seekToLatest = () => {
    const media = video.current;
    if (!media || !Number.isFinite(media.duration) || media.seeking) return;
    // Keep the final requested position when rapid input arrives during decoding.
    const target = Math.min(requestedTime.current, Math.max(0, media.duration - 1 / 24));
    if (Math.abs(media.currentTime - target) > 1 / 48) media.currentTime = target;
  };
  useEffect(() => {
    if (!video.current || !Number.isFinite(video.current.duration)) return;
    requestedTime.current = video.current.duration * progress / 100;
    seekToLatest();
  }, [progress, ready]);
  useEffect(() => {
    const frame = stage.current;
    if (!frame || reduceMotion || failed || buffered.loading || buffered.failed) return;
    const onWheel = (event: WheelEvent) => {
      // Leave pinch-to-zoom and horizontal gestures to the browser.
      if (!video.current || !Number.isFinite(video.current.duration) || event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const current = progressRef.current;
      if ((current >= 100 && event.deltaY > 0) || (current <= 0 && event.deltaY < 0)) return;
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1);
      const next = Math.max(0, Math.min(100, current + pixels / 81));
      progressRef.current = next;
      if (wheelFrame.current === null) wheelFrame.current = requestAnimationFrame(() => {
        wheelFrame.current = null;
        setProgress(progressRef.current);
      });
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      frame.removeEventListener('wheel', onWheel);
      if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
      wheelFrame.current = null;
    };
  }, [reduceMotion, ready, failed, buffered.loading, buffered.failed]);
  return <section className="design-demo section" aria-labelledby={compact ? 'home-demo-heading' : 'motion-demo-heading'}>
    <div className="editorial-heading"><div><p className="eyebrow">{l('INTERACTIVE WEB EXPERIENCES', 'အပြန်အလှန်တုံ့ပြန်သော ဝဘ်အတွေ့အကြုံ')}</p><h2 id={compact ? 'home-demo-heading' : 'motion-demo-heading'}>{l('A website you can play with.', 'ကိုယ်တိုင် စမ်းသပ်ကြည့်နိုင်သော ဝဘ်ဆိုက်။')}</h2></div><p>{l('Move the slider. Explore the details. Give your customers a reason to stay.', 'ဆလိုက်ဒါကို ရွှေ့ပြီး အသေးစိတ် စမ်းသပ်ကြည့်ပါ။')}</p><div className="tea-explanation"><p>{l('Follow a tea leaf from the hillside to the shop: growing, harvesting, fermenting and packaging. Each scroll moves the story forward; scroll back to revisit a step.','တောင်စောင်းရှိ လက်ဖက်ခင်းမှ ဆိုင်အထိ — စိုက်ပျိုးခြင်း၊ ခူးဆွတ်ခြင်း၊ အချဉ်ဖောက်ခြင်းနှင့် ထုပ်ပိုးခြင်းတို့ကို ကြည့်ပါ။ Scroll ဖြင့် ရှေ့တိုးနောက်ဆုတ် ကြည့်နိုင်ပါသည်။')}</p><div className="tea-use-cases motion-uses uses-desktop"><small>{l('WORKS WELL FOR','အသုံးပြုနိုင်သည့်နေရာများ')}</small><div><span>{l('Product journeys','ထုတ်ကုန်ခရီးစဉ်များ')}</span><span>{l('Brand stories','အမှတ်တံဆိပ် ဇာတ်လမ်းများ')}</span><span>{l('Process explainers','လုပ်ငန်းစဉ် ရှင်းလင်းချက်များ')}</span></div></div></div></div>
    <div className="tea-demo-media">
    <div className="demo-toolbar"><p className="eyebrow">{l('TEA / FROM FIELD TO SHOP','လက်ဖက် / စိုက်ခင်းမှ ဆိုင်အထိ')}</p><button type="button" className="demo-reset" onClick={() => updateProgress(0)}><RotateCcw size={16}/>{l('Reset','ပြန်စရန်')}</button></div>
    <div className="demo-stage demo-tea-stage" ref={stage}>
      <video ref={video} muted playsInline preload="auto" poster={getMedia("teaJourneyPoster", "/videos/start-end/tea-journey-poster.jpg")} onLoadedMetadata={event => { setReady(true); requestedTime.current = event.currentTarget.duration * progress / 100; seekToLatest(); }} onSeeked={seekToLatest} onError={() => setFailed(true)} src={buffered.src || undefined} aria-label={l('Tea journey: growth, harvest, fermentation, packaging and shop sale','လက်ဖက်ခရီးစဉ် — စိုက်ပျိုးခြင်း၊ ခူးဆွတ်ခြင်း၊ အချဉ်ဖောက်ခြင်း၊ ထုပ်ပိုးခြင်းနှင့် ရောင်းချခြင်း')}/>
      {buffered.loading && <p className="demo-loading" role="status">{l('Preparing the interactive video…','အပြန်အလှန်တုံ့ပြန်သော ဗီဒီယိုကို ပြင်ဆင်နေသည်…')}</p>}
      {(failed || buffered.failed) && <p className="demo-error" role="status">{l('The animation could not load. Please reload the page to try again.','Animation မရရှိနိုင်ပါ။ စာမျက်နှာကို ပြန်ဖွင့်ပြီး စမ်းကြည့်ပါ။')}</p>}
    </div>
    <div className="demo-controls"><label htmlFor={compact ? 'home-progress' : 'motion-progress'}>{l('Drag to explore','ရွှေ့၍ စမ်းသပ်ရန်')} <output>{Math.round(progress)}%</output></label><input id={compact ? 'home-progress' : 'motion-progress'} type="range" disabled={!ready || buffered.loading || buffered.failed} min="0" max="100" step="0.1" value={progress} onChange={event => { updateProgress(Number(event.target.value)); }} aria-label={l('Animation progress','Animation တိုးတက်မှု')}/><p className="demo-scroll-hint">{reduceMotion ? l('Reduced motion: use the slider to explore.','လှုပ်ရှားမှု လျှော့ထားသည်။ ဆလိုက်ဒါဖြင့် စမ်းသပ်ပါ။') : l('Scroll inside the frame to explore the tea journey. Scroll outside to move the page, or keep scrolling at either end. On touch screens, use the slider.','ဘောင်အတွင်း scroll ဖြင့် လက်ဖက်ခရီးစဉ်ကို ကြည့်ပါ။ ဘောင်အပြင်တွင် စာမျက်နှာကို ရွှေ့နိုင်သည်။ Touch screen တွင် ဆလိုက်ဒါကို အသုံးပြုပါ။')}</p></div>
    </div>
    {compact && <Link className="editorial-link" to="/motion">{l('Try all interactive demos','စမ်းသပ်မှုအားလုံး ကြည့်ရန်')}<ArrowUpRight size={18}/></Link>}
  <div className="tea-use-cases motion-uses uses-stacked"><small>{l('WORKS WELL FOR','အသုံးပြုနိုင်သည့်နေရာများ')}</small><div><span>{l('Product journeys','ထုတ်ကုန်ခရီးစဉ်များ')}</span><span>{l('Brand stories','အမှတ်တံဆိပ် ဇာတ်လမ်းများ')}</span><span>{l('Process explainers','လုပ်ငန်းစဉ် ရှင်းလင်းချက်များ')}</span></div></div>
</section>;
}
