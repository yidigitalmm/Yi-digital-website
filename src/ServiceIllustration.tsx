import { getMedia } from './cms/siteContent';
type Kind = 'shop' | 'booking' | 'loyalty' | 'profile' | 'catalog' | 'language' | 'motion' | 'cms' | 'care' | 'social' | 'invite';

/** Decorative imagery; service names, scope and prices remain accessible HTML. */
export function ServiceIllustration({ kind }: { kind: Kind }) {
  return <img
    className={`service-illustration service-image art-${kind}`}
    src={getMedia(`service${kind[0].toUpperCase()}${kind.slice(1)}`, `/images/services/${kind}-v2.jpg`)}
    alt=""
    width={768}
    height={512}
    loading="lazy"
    decoding="async"
  />;
}
