# Website content check — 10 September 2026

Reviewed the public homepage, Services, Our Work, Journal, Contact and Animation pages; the live Google Business Profile article; the Myanmar Our Work page; and all 22 local content JSON files. Reviewed all seven English article bodies and checked English/Myanmar article section and checklist counts. This was a content review, not a full translation, interaction, or external-link audit. No website content was changed or published.

## Findings

| Priority | Location | Finding | Suggested action |
| --- | --- | --- | --- |
| High | [Our Work](https://yidigitalmm.com/our-work/) | The introduction says customer names remain private, while the page names Sein Htan Pin, The Peak and Taunggyi Hotel. It also says package/add-on entries are provisional reference mappings, while headings present them as actual customer choices and delivered work. Confirmed in English and Myanmar. | Establish which details are approved facts. Use actual scope for verified projects and explicitly label any illustrative package mapping. Rewrite the introduction consistently in both languages. |
| Medium | [Homepage](https://yidigitalmm.com/) | The selected-work stack still includes “In progress” and “More coming soon.” Both link to the general work page without corresponding project details. These are active placeholders, including their accessible link labels. | Remove the cards until there is publishable work, or give them intentional preview content and a useful destination. |
| Medium | [Contact](https://yidigitalmm.com/contact/) | The FAQ promises contact through the visitor’s “preferred channel,” but the form only collects email and optional phone; there is no channel selection. | Say that replies arrive by email, or add a real channel preference and use it in the enquiry workflow. |
| Medium | [Google profile article](https://yidigitalmm.com/journal/complete-google-business-profile/) | The maintenance advice groups “messages, calls” with profile performance metrics without distinguishing current messaging options, call-button clicks, or retired features. | Clarify that calls refers to call-button clicks, and that messages should be checked in configured supported channels. Google retired native Business Profile chat and call history on 31 July 2024; eligible profiles can use text/WhatsApp options. This is ambiguous guidance needing an update, not proof that all call or messaging features are unavailable. See [Google’s feature-change notice](https://support.google.com/business/answer/14919056?hl=en) and [current performance definitions](https://support.google.com/business/answer/9918094?co=GENIE.Platform%3DDesktop). |
| Low | Stored page content | Old clinic case-study copy remains in `content/pages/site-work.json`, including “Clinic reception placeholder,” “To be documented,” and “Case study coming soon.” An unused “Contact details confirmed before launch” string remains in contact content. These were not rendered on the current live pages checked. | Remove obsolete entries together with matching defaults and any dependencies during a content cleanup. Avoid treating them as live-page defects. |

## Items to confirm with the business

- **First portfolio project:** “Customizable” is a generic title, has no live URL, and uses a planning image. Confirm whether it is an approved project/brand name or unfinished example content before renaming it. Sources: `content/work/1.json`, `src/visuals.tsx`.
- **Client website destinations:** The Peak and Taunggyi Hotel “Visit live website” links use `workers.dev` addresses. These may be intentional production addresses; their domain alone does not prove they are stale. Confirm whether final customer domains should replace them. Sources: `content/work/3.json`, `content/work/4.json`. External destinations were not tested.
- **Photography scope:** The Services FAQ says photography support is available through the Content Planning add-on, while the priced add-on is simply “Website content planning” at 200,000 MMK. Photography is separately excluded from Connected Presence. Those exclusions apply to different scopes, so this is not necessarily a contradiction, but the paid add-on needs a clear photography scope or separate quotation wording. Sources: `content/pages/site-services.json:265`, `content/pages/site-packages.json`.
- **Public email:** The site promotes domain-based email but publishes a Gmail address. This is a branding consistency opportunity, not a broken address. Only replace it with an inbox confirmed to receive enquiries. Source: `content/settings/business.json:5`.
- **Freshness ownership:** Articles have no publication/review dates, so their age cannot be inferred from “Latest notes.” Confirm prices, phone, location, and service availability with their owner; internal consistency does not establish that business details remain current.

## Checks that passed and limitations

- All local image paths found under `/uploads/` and `/images/` in the 22 content JSON files resolve to existing files.
- No nonempty English page string had a blank paired Myanmar translation. All seven articles have four sections and five checklist items in each language. This checks completeness, not translation quality.
- The displayed package card and comparison-table prices agree: 600,000; 1,000,000; 1,500,000; and from 3,000,000 MMK.
- Copyright is 2026, matching the review year.
- The checked main routes loaded in the browser. The initial Animation loading message resolved to content; the 3D interaction itself was not tested.
- No form was submitted, no social accounts were contacted, and no claim is made about external-link health or email delivery.
- The initial web-fetch and local network tools could not access the site, but the browser successfully loaded it. Findings described as live were verified in that browser.

## Editing references

- Portfolio introduction: `content/pages/site-work.json:265`, rendered by `src/pages.tsx:264`.
- Homepage future-work cards: `content/pages/site-home.json:325`, `content/pages/site-home.json:337`, and `src/visuals.tsx:198`.
- Contact channel promise: `content/pages/site-contact.json:355`, rendered by `src/pages.tsx:373`.
- Google profile advice: `content/journal/complete-google-business-profile.json:41`.

Update source content and matching defaults where needed; regenerate `src/cms/snapshot.json` through the project's content build instead of editing that generated file directly.
