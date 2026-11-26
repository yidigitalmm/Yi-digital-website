// Draft offering for the Services page. Unconfirmed terms remain explicit placeholders.
import type { Locale } from './content.ts';
export function serviceOfferingDefaults(locale: Locale) {
  const l = (en: string, my: string) => locale === 'my' ? my : en;
  const pending = l('To be confirmed', 'အတည်ပြုရန် ကျန်ရှိ');
  const options = [
    { numeral: 'I', name: l('Single-Page Website','စာမျက်နှာတစ်မျက်နှာ ဝဘ်ဆိုက်'), price: 'US$200', recommended: false, summary: l('A focused introduction to your business on one page.','သင့်လုပ်ငန်းအကြောင်းကို စာမျက်နှာတစ်မျက်နှာဖြင့် မိတ်ဆက်ရန်။'), bullets: [l('Up to 6 sections','အပိုင်း ၆ ခုအထိ'),l('Content planning included','အကြောင်းအရာ စီစဉ်ခြင်း ပါဝင်'),l('AI image creation as needed','လိုအပ်သလို AI ပုံများ ဖန်တီးပေးခြင်း'),l('3 design revisions + 3 implementation reviews','ဒီဇိုင်းပြင်ဆင်မှု ၃ ကြိမ်နှင့် တည်ဆောက်ပြီး စစ်ဆေးမှု ၃ ကြိမ်'),l('30 days post-launch support','စတင်အသုံးပြုပြီး ရက် ၃၀ ပံ့ပိုးမှု')] },
    { numeral: 'II', name: l('Basic Business Website','အခြေခံလုပ်ငန်း ဝဘ်ဆိုက်'), price: 'US$300', recommended: true, summary: l('More space to present your company, services and experience.','ကုမ္ပဏီ၊ ဝန်ဆောင်မှုနှင့် အတွေ့အကြုံများကို အသေးစိတ် ဖော်ပြရန်။'), bullets: [l('Up to 8 informational pages','အချက်အလက် စာမျက်နှာ ၈ မျက်နှာအထိ'),l('Content planning included','အကြောင်းအရာ စီစဉ်ခြင်း ပါဝင်'),l('AI image creation as needed','လိုအပ်သလို AI ပုံများ ဖန်တီးပေးခြင်း'),l('3 design revisions + 3 implementation reviews','ဒီဇိုင်းပြင်ဆင်မှု ၃ ကြိမ်နှင့် တည်ဆောက်ပြီး စစ်ဆေးမှု ၃ ကြိမ်'),l('30 days post-launch support','စတင်အသုံးပြုပြီး ရက် ၃၀ ပံ့ပိုးမှု')] },
    { numeral: 'III', name: l('Company Profile PDF','ကုမ္ပဏီမိတ်ဆက် PDF'), price: 'US$75', recommended: false, summary: l('A PDF for trade fairs, customer presentations and vendor registration.','ကုန်စည်ပြပွဲ၊ ဖောက်သည်မိတ်ဆက်မှုနှင့် ပေးသွင်းသူမှတ်ပုံတင်ရန် PDF။'), bullets: [l('One language included','ဘာသာစကား တစ်မျိုး ပါဝင်'),l('Company introduction and capabilities','ကုမ္ပဏီမိတ်ဆက်နှင့် လုပ်ငန်းစွမ်းဆောင်ရည်'),l('Shareable PDF document, not a website','မျှဝေနိုင်သော PDF ဖိုင်ဖြစ်ပြီး ဝဘ်ဆိုက်မဟုတ်ပါ'),l('Page limit: ','စာမျက်နှာအရေအတွက်: ')+pending,l('Revision allowance: ','ပြင်ဆင်ခွင့်: ')+pending] },
    { numeral: 'IV', name: l('Product Catalog PDF','ကုန်ပစ္စည်း ကတ်တလောက် PDF'), price: 'US$75', recommended: false, summary: l('A product document for buyers, customers and trade events.','ဝယ်ယူသူ၊ ဖောက်သည်နှင့် ကုန်စည်ပြပွဲများအတွက် ကုန်ပစ္စည်းမိတ်ဆက်ဖိုင်။'), bullets: [l('One language included','ဘာသာစကား တစ်မျိုး ပါဝင်'),l('Product images and specifications','ကုန်ပစ္စည်းပုံများနှင့် အသေးစိတ်အချက်အလက်'),l('Shareable PDF document, not an online store','မျှဝေနိုင်သော PDF ဖိုင်ဖြစ်ပြီး အွန်လိုင်းဆိုင်မဟုတ်ပါ'),l('Page / product limit: ','စာမျက်နှာ / ကုန်ပစ္စည်းအရေအတွက်: ')+pending,l('Revision allowance: ','ပြင်ဆင်ခွင့်: ')+pending] },
  ];
  const yes=l('Included','ပါဝင်'); const na='—';
  return { options, rows: [
    [l('Price','ဈေးနှုန်း'),...options.map(x=>x.price)],
    [l('Format & scope','ပုံစံနှင့် အတိုင်းအတာ'),l('1 page / 6 sections','၁ မျက်နှာ / ၆ ပိုင်း'),l('Up to 8 pages','၈ မျက်နှာအထိ'),l('PDF · limit to confirm','PDF · အရေအတွက် အတည်ပြုရန်'),l('PDF · limit to confirm','PDF · အရေအတွက် အတည်ပြုရန်')],
    [l('Languages','ဘာသာစကား'),l('1 language','၁ မျိုး'),l('1 language','၁ မျိုး'),l('1 language','၁ မျိုး'),l('1 language','၁ မျိုး')],
    [l('Content planning','အကြောင်းအရာ စီစဉ်ခြင်း'),yes,yes,pending,pending],
    [l('AI imagery as needed','လိုအပ်သလို AI ပုံဖန်တီးခြင်း'),yes,yes,pending,pending],
    [l('Pre-development revisions','တည်ဆောက်မီ ဒီဇိုင်းပြင်ဆင်မှု'),'3','3',na,na],
    [l('Post-development reviews','တည်ဆောက်ပြီး စစ်ဆေးမှု'),'3','3',na,na],
    [l('Post-launch support','စတင်အသုံးပြုပြီး ပံ့ပိုးမှု'),l('30 days','ရက် ၃၀'),l('30 days','ရက် ၃၀'),na,na],
    [l('CMS','CMS'),l('Optional · US$125','ထပ်တိုး · US$125'),l('Optional · US$125','ထပ်တိုး · US$125'),na,na],
    [l('Annual maintenance','နှစ်စဉ် ထိန်းသိမ်းမှု'),l('30% of project price','ပရောဂျက်တန်ဖိုး၏ ၃၀%'),l('30% of project price','ပရောဂျက်တန်ဖိုး၏ ၃၀%'),na,na],
  ], terms: [
    [l('Website revisions','ဝဘ်ဆိုက် ပြင်ဆင်မှု'),l('3 consolidated design revision rounds before development and 3 implementation review rounds after development. New functionality or a new design direction is scoped separately.','တည်ဆောက်မီ ဒီဇိုင်းပြင်ဆင်မှု ၃ ကြိမ်နှင့် တည်ဆောက်ပြီး စစ်ဆေးမှု ၃ ကြိမ်။ လုပ်ဆောင်ချက်အသစ် သို့မဟုတ် ဒီဇိုင်းအသစ်အတွက် သီးခြားသတ်မှတ်ပါမည်။')],
    [l('Maintenance & content updates','ထိန်းသိမ်းမှုနှင့် အကြောင်းအရာပြင်ဆင်မှု'),l('Annual maintenance is 30% of the project price, starting on the subscription date. Includes one data-update request per month, with unused requests expiring at the end of each calendar month and no rollover; design and layout changes are excluded. Additional technical coverage is to be confirmed.','နှစ်စဉ်ထိန်းသိမ်းခမှာ ပရောဂျက်တန်ဖိုး၏ ၃၀% ဖြစ်ပြီး စာရင်းသွင်းသည့်နေ့မှ စတင်သည်။ တစ်လလျှင် ဒေတာပြင်ဆင်ခွင့် ၁ ကြိမ် ပါဝင်သည်။ မသုံးဖြစ်သော ပြင်ဆင်ခွင့်သည် လကုန်တွင် သက်တမ်းကုန်ပြီး နောက်လသို့ လွှဲပြောင်း၍ မရပါ။ ဒီဇိုင်းနှင့် layout ပြင်ဆင်ခြင်း မပါဝင်ပါ။ နည်းပညာပံ့ပိုးမှု အသေးစိတ် အတည်ပြုရန် ကျန်ရှိသည်။')],
    [l('Scope still to agree','အတည်ပြုရန် ကျန်ရှိသော အတိုင်းအတာ'),l('Hosting is included for simple websites hosted on Cloudflare. Additional resource costs are charged separately. First-year registration of a standard domain priced below US$20 is included; higher-priced domains are charged separately. The first website implementation is delivered within 14 days after design confirmation.','Cloudflare တွင် တင်နိုင်သော ရိုးရှင်းသည့်ဝဘ်ဆိုက်များအတွက် hosting ပါဝင်သည်။ ထပ်တိုး resource ကုန်ကျစရိတ်ကို သီးခြားကောက်ခံသည်။ US$20 အောက် ပုံမှန်ဒိုမိန်း၏ ပထမနှစ်မှတ်ပုံတင်ခ ပါဝင်ပြီး ဈေးမြင့်ဒိုမိန်းကို သီးခြားကောက်ခံသည်။ ဒီဇိုင်းအတည်ပြုပြီး ၁၄ ရက်အတွင်း ပထမအကြိမ် တည်ဆောက်မှုကို ပေးအပ်မည်။')],
  ], addons: [
    [l('E-Commerce system','အွန်လိုင်းအရောင်းစနစ်'),l('US$250–375','US$250–375')],
    [l('Live Booking System','အချိန်နှင့်တစ်ပြေးညီ ဘွတ်ကင်စနစ်'),l('US$250–375','US$250–375')],
    [l('Membership & Loyalty','အသင်းဝင်နှင့် ဆုလာဘ်စနစ်'),l('US$300–450','US$300–450')],
    [l('Additional standard page','ထပ်တိုး ပုံမှန်စာမျက်နှာ'),l('US$25 / page','US$25 / မျက်နှာ')],
    [l('Additional website language','ထပ်တိုး ဝဘ်ဆိုက်ဘာသာစကား'),l('30% of project price / language','ပရောဂျက်တန်ဖိုး၏ ၃၀% / ဘာသာစကား')],
    [l('Custom Scroll Animation','စိတ်ကြိုက် Scroll Animation'),l('US$75 / section','US$75 / အပိုင်းတစ်ခု')],
    [l('Content-editing CMS (not layout)','အကြောင်းအရာပြင်ဆင်ရန် CMS (layout မပါ)'),'US$125'],
    [l('Additional design revision','ထပ်တိုး ဒီဇိုင်းပြင်ဆင်မှု'),pending],
    [l('Minor content update','အသေးစား အကြောင်းအရာပြင်ဆင်မှု'),pending],
    [l('Digital invitations & events','ဒစ်ဂျစ်တယ်ဖိတ်စာနှင့် ပွဲများ'),pending],
  ] };
}
