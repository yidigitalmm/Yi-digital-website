import editorial from './editorialDefaults.json' with { type: 'json' };
export const motionUseCaseDefaults = editorial['motion-use-cases'];
export const serviceMediaDefaults = Object.fromEntries(
  ['shop','booking','loyalty','profile','catalog','language','motion','cms','care','social','invite']
    .map(kind => [`service${kind[0].toUpperCase()}${kind.slice(1)}`, `/images/services/${kind}-v2.jpg`]),
);
export const videoDefaults = {
  teaJourneyVideo: '/videos/start-end/tea-journey-web-v2.mp4',
  teaJourneyPoster: '/videos/start-end/tea-journey-poster.jpg',
  motionLayeredVideo: '/videos/start-end/burger-build-transparent.webm',
  motionLayeredFallback: '/videos/start-end/burger-build.mp4',
  motionSurpriseVideo: '/videos/start-end/blind-box-reveal-transparent.webm',
  motionSurpriseFallback: '/videos/start-end/blind-box-reveal-fallback.mp4',
  motionTransformationVideo: '/videos/start-end/kitchen-build.mp4',
};
export const editorialDefinitions = Object.entries(editorial).map(([id, values]) => ({
  id: `site-${id}`, title: ({ 'services-faq':'Services — updated FAQ answers', 'services-details':'Services — headings, inclusions & terms', tea:'Animation — tea journey', 'home-demo':'Home — search demonstration', 'home-services':'Home — service summaries', 'motion-use-cases':'Animation — example use cases' } as Record<string,string>)[id],
  en: values.en, my: values.my,
}));
