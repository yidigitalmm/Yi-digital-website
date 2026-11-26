import type { Locale } from './content';
import { pageContent } from './cms/siteContent';
import { serviceOfferingDefaults } from './serviceOfferingDefaults';

export function serviceOffering(locale: Locale) {
  return pageContent('site-offerings', locale, serviceOfferingDefaults(locale));
}
