import { editorialText } from './cms/editorialText';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, MapPin, Clock3, Eye, Search, ShieldCheck, BarChart3 } from 'lucide-react';
import { copy, images, type Locale } from './content';
import { optimizedImage } from './optimizedImages';
import { SectionTitle } from './ui';

export function HomeTransformation({ locale }: { locale: Locale }) {
  const c = copy[locale].home;
  const l = (en: string, my: string) => editorialText('home-demo', locale, en, my);
  const [after, setAfter] = useState(false);
  const [searching, setSearching] = useState(false);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLElement>(null);
  const interacted = useRef(false);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !window.IntersectionObserver) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        timer = setTimeout(() => { if (!interacted.current) setAfter(true); }, 3200);
        observer.disconnect();
      }
    }, { threshold: .45 });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!visible || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setSearching(true);
    const timer = setTimeout(() => setSearching(false), 1400);
    return () => clearTimeout(timer);
  }, [after, visible]);
  const select = (value: boolean) => { interacted.current = true; setVisible(true); setAfter(value); };
  const icons = [Eye, ShieldCheck, BarChart3];
  return <section ref={root} className="section transformation-compact">
    <SectionTitle eyebrow={c.outcomeEyebrow} title={c.outcomeTitle} />
    <div className="transformation-layout">
      <div className="transformation-benefits">{c.outcomes.map(([title, body], i) => {
        const Icon = icons[i];
        return <article key={title}><Icon aria-hidden="true"/><div><h3>{title}</h3><p>{body}</p></div></article>;
      })}</div>
      <div className={`transformation-demo ${after ? 'is-after' : 'is-before'} ${searching ? 'is-searching' : ''}`}>
        <div className="transformation-switch" role="group" aria-label={l('Compare before and after','မတိုင်မီနှင့် ပြီးနောက် နှိုင်းယှဉ်ရန်')}>
          <button type="button" aria-pressed={!after} onClick={() => select(false)}>{c.before[0]}</button><ArrowRight size={18} aria-hidden="true"/><button type="button" aria-pressed={after} onClick={() => select(true)}>{c.after[0]}</button>
        </div>
        <h3>{after ? c.after[1] : c.before[1]}</h3>
        <div className="transformation-search"><Search size={18}/><span>{l("Suky","Suky")}</span></div>
        <div className="transformation-scene" aria-busy={searching}>
          {searching && <div className="search-in-progress" role="status"><span className="search-spinner"/><strong>{l('Searching for Suky…','Suky ကို ရှာဖွေနေသည်…')}</strong><div className="search-scan"><i/><i/><i/></div></div>}
          <div className="transformation-empty" aria-hidden={after || searching}><span className="missing-mark">?</span><strong>{l('Your business is missing.','သင့်လုပ်ငန်းကို ရှာမတွေ့ပါ။')}</strong><div className="search-placeholders"><i/><i/></div></div>
          <div className="transformation-found" aria-hidden={!after || searching}><img {...optimizedImage(images.cafeCounter)} sizes="150px" loading="lazy" alt=""/><div><strong>{l("Suky","Suky")}</strong><span className="mock-rating">{l("★ 4.8","★ 4.8")} <span>{l('(86 reviews) · Café','(သုံးသပ်ချက် ၈၆ ခု) · ကော်ဖီဆိုင်')}</span></span><span><Clock3 size={15}/>{l('Open · Closes at 8 pm','ဖွင့်ထားသည် · ည ၈ နာရီ ပိတ်မည်')}</span><span><MapPin size={15}/>{l('Sanchaung, Yangon','စမ်းချောင်း၊ ရန်ကုန်')}</span><span className="demo-contact">{l('Website · Directions · Contact','ဝဘ်ဆိုက် · လမ်းညွှန် · ဆက်သွယ်ရန်')}</span></div></div>
        </div>

      </div>
    </div>
  </section>;
}
