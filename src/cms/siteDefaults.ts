import { copy, images } from "../contentDefaults.ts";
import { showcaseCopy, startEndCopy, cameraCopy } from "../animationCopyDefaults.ts";
import { pages } from "../seoDefaults.ts";
import { interfaceDefaults } from "../interfaceCopyDefaults.ts";
export const businessDefaults = {
  brandName: "Yi Digital", phone: "+95 9251183379", phoneNumber: "+959251183379", email: "yidigitalmm@gmail.com", viberNumber: "+959251183379",
  address: "132 Bogalayzay Street, Botahtaung Township, Yangon, 11161",
  facebook: "https://www.facebook.com/share/19HCDvhMmE/?mibextid=wwXIfr", instagram: "https://www.instagram.com/yidigitalmm/",
  tiktok: "https://www.tiktok.com/@yidigitalmm?_r=1&_t=ZP-99a3IweRJQV", linkedin: "https://www.linkedin.com/company/yi-digital",
};
export const animationDefaults = {
  en: { motion: startEndCopy.en, reveal: showcaseCopy.en, camera: cameraCopy.en },
  my: { motion: startEndCopy.my, reveal: showcaseCopy.my, camera: cameraCopy.my },
};
export const pageDefinitions = [
  { id: "site-messages", title: "Form messages & error page", en: interfaceDefaults.en, my: interfaceDefaults.my },
  { id: "site-global", title: "Footer & process text", en: copy.en.global, my: copy.my.global },
  { id: "site-home", title: "Home page", en: copy.en.home, my: copy.my.home },
  { id: "site-services", title: "Services & FAQs", en: copy.en.services.text, my: copy.my.services.text },
  { id: "site-packages", title: "Packages & pricing", en: { packages: copy.en.services.packages, connectedPresence: copy.en.services.connectedPresence, websiteAddons: copy.en.services.websiteAddons, sourceCodeTransfer: copy.en.services.sourceCodeTransfer }, my: { packages: copy.my.services.packages, connectedPresence: copy.my.services.connectedPresence, websiteAddons: copy.my.services.websiteAddons, sourceCodeTransfer: copy.my.services.sourceCodeTransfer } },
  { id: "site-contact", title: "Contact page & FAQs", en: copy.en.contact, my: copy.my.contact },
  { id: "site-work", title: "Previous Work page text", en: copy.en.previousWork, my: copy.my.previousWork },
  { id: "site-journal", title: "Journal page text", en: copy.en.journal, my: copy.my.journal },
  { id: "site-animation", title: "Animation page", en: animationDefaults.en, my: animationDefaults.my },
  { id: "site-seo", title: "Search & sharing descriptions", en: pages.en, my: pages.my },
] as const;
export const mediaDefaults = {
  ...images,
  logoLight: "/brand/yi-digital-horizontal-light.svg", logoDark: "/brand/yi-digital-horizontal-dark.svg", socialShare: "/social-share.png",
  projectExporter: "/images/projects/sein-htan-pin-preview.webp", projectRestaurant: "/images/projects/the-peak-preview.webp", projectHotel: "/images/projects/taunggyi-hotel-preview.webp",
  projectInProgress: "/images/projects/in-progress-card.png", projectComingSoon: "/images/projects/more-coming-soon-card.png",
  cameraPoster: "/images/generated/instant-camera-reference.png", revealArmor: "/images/generated/android-black-gold-powered-armor-cropped.webp",
  motionLayeredPoster: "/videos/start-end/burger-build-transparent-poster.png", motionSurprisePoster: "/videos/start-end/blind-box-reveal-transparent-poster.png", motionTransformationPoster: "/videos/start-end/kitchen-build-poster.jpg",
};
