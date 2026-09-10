export type JournalArticle = {
  slug: string;
  category: string;
  title: string;
  summary: string;
  image: string;
  imageAlt: string;
  readTime: string;
  intro: string;
  sections: Array<{
    heading: string;
    paragraphs: string[];
  }>;
  checklist: string[];
  closing: string;
};

export const journalArticles: JournalArticle[] = [
  {
    slug: "why-online-presence-matters",
    category: "Featured article",
    title: "Why online presence matters for local businesses",
    summary: "People search before they decide. A clear online presence helps them find you, trust you, and take the next step.",
    image: "/images/journal/why-online-presence-matters.webp",
    imageAlt: "Customer checking a local shop's profile, hours, reviews, and location on a phone outside the storefront",
    readTime: "6 min read",
    intro: "For a local business, an online presence is no longer separate from the business itself. It is often the first doorway a customer walks through—even when the final purchase happens face to face.",
    sections: [
      {
        heading: "The decision begins before the visit",
        paragraphs: [
          "A customer may hear your name from a friend, notice your storefront, or search for a service nearby. Their next move is usually the same: they look online. They want to confirm that the business exists, understand what it offers, and decide whether it feels dependable.",
          "If your information is missing, inconsistent, or difficult to understand, the customer has to do extra work. Most people will not investigate for long. They will choose the business that answers their questions more quickly and clearly.",
        ],
      },
      {
        heading: "Visibility and trust work together",
        paragraphs: [
          "Being visible is not simply appearing in search results. A useful presence connects your website, Google profile, social accounts, contact details, opening hours, and location. Each part should confirm the same story about your business.",
          "That consistency creates trust. Customers feel more confident when the name, address, phone number, services, and visual identity match wherever they look. Small details signal that the business is active and attentive.",
        ],
      },
      {
        heading: "Your presence should make action easy",
        paragraphs: [
          "A good online presence guides people toward a practical next step: call, message, request directions, view a menu, book an appointment, or send an enquiry. The path should be obvious on a phone and should not depend on the customer searching through several pages.",
          "This is where a simple, properly built foundation often outperforms a complicated one. Clear information, fast loading, readable pages, and working contact links are more valuable than features that look impressive but create friction.",
        ],
      },
      {
        heading: "Build the foundation before chasing attention",
        paragraphs: [
          "Advertising and frequent posting can bring attention, but attention is easily wasted if the destination is incomplete. Before investing in promotion, make sure customers can understand the business, verify essential details, and contact you without confusion.",
          "A strong foundation gives every future activity somewhere useful to lead. It also becomes easier to measure what is working and improve the experience over time.",
        ],
      },
    ],
    checklist: [
      "Your business name and contact details match across every channel",
      "Google Maps, opening hours, and location information are accurate",
      "Your website explains what you offer in plain language",
      "Call, message, enquiry, and direction links work on mobile",
      "Recent photos and updates show that the business is active",
    ],
    closing: "The goal is not to be everywhere. It is to be clear and credible wherever your customers already look.",
  },
  {
    slug: "what-customers-expect-before-contact",
    category: "Customer experience",
    title: "What customers expect to find before they contact you",
    summary: "Answer the practical questions customers ask silently before they decide to call, message, visit, or book.",
    image: "/images/journal/what-customers-expect.webp",
    imageAlt: "Customer comparing a local business's services, pricing, hours, reviews, location, and contact options before calling",
    readTime: "5 min read",
    intro: "Before a customer contacts a business, they usually complete a quiet checklist. They want enough information to feel that reaching out will be worthwhile—and safe.",
    sections: [
      {
        heading: "A clear explanation of what you do",
        paragraphs: [
          "Customers should not have to interpret vague language or industry terminology. Within a few seconds, they should understand what you provide, who it is for, and whether you serve their location or situation.",
          "Lead with the service customers recognize, then add the detail they need to compare options. A short, specific explanation is more useful than a long introduction about the company.",
        ],
      },
      {
        heading: "Proof that the business is real and current",
        paragraphs: [
          "A physical address, service area, working phone number, current opening hours, real photographs, and recent reviews all reduce uncertainty. Together, they answer the unspoken question: can I rely on this business today?",
          "Outdated information creates more doubt than having less information. If a customer arrives during the wrong opening hours or calls a disconnected number, trust is difficult to recover.",
        ],
      },
      {
        heading: "Enough detail to understand the next step",
        paragraphs: [
          "People want to know what happens after they make contact. Should they book, visit, request a quote, send measurements, or prepare documents? A brief explanation of the process makes the first conversation easier for both sides.",
          "Price guidance can also help. Not every business needs a complete public price list, but a starting price, typical range, or explanation of how quotations work helps customers assess fit before enquiring.",
        ],
      },
      {
        heading: "A contact route that matches the customer",
        paragraphs: [
          "Some customers want to call. Others prefer Messenger, WhatsApp, email, or a short enquiry form. Offer the channels you can respond to consistently, and make them easy to find on every important page.",
          "Do not create more channels than the business can maintain. A smaller number of reliable contact options gives a better experience than many neglected inboxes.",
        ],
      },
    ],
    checklist: [
      "A one-sentence description of the main service",
      "Accurate hours, location, service area, and contact details",
      "Real photographs of the place, people, products, or work",
      "A simple explanation of pricing or quotation steps",
      "One prominent and reliable way to contact the business",
    ],
    closing: "The best business websites do not make customers curious about basic facts. They make customers confident about the next step.",
  },
  {
    slug: "why-business-email-matters",
    category: "Branding & trust",
    title: "Why a business email changes first impressions",
    summary: "A domain-based email is a small operational detail that makes a business feel established, accountable, and easier to trust.",
    image: "/images/journal/why-business-email-matters.webp",
    imageAlt: "Business owner composing an email from hello@yourbusiness.com beside a matching business invoice",
    readTime: "5 min read",
    intro: "An email address is easy to overlook because it feels purely functional. To a customer, however, it is part of the brand—and often part of the first impression.",
    sections: [
      {
        heading: "Your domain connects the message to the business",
        paragraphs: [
          "An address such as hello@yourbusiness.com immediately confirms who the message represents. It connects the conversation to the same name customers see on the website, quotation, invoice, and social profiles.",
          "A free personal address can still work, but it asks the customer to make an extra trust decision. Is this the correct person? Is the message official? A business address removes that uncertainty.",
        ],
      },
      {
        heading: "Professional does not need to feel corporate",
        paragraphs: [
          "A small business does not need dozens of formal inboxes. One or two clear addresses—such as hello@, bookings@, or the owner’s name—are often enough. The goal is clarity, not bureaucracy.",
          "Choose names that make sense to customers and assign responsibility for checking each inbox. An elegant address only helps when messages receive a dependable response.",
        ],
      },
      {
        heading: "Consistency strengthens recognition",
        paragraphs: [
          "Using the same domain for the website and email reinforces the business name each time a customer sees it. It also makes printed materials, proposals, receipts, and staff signatures feel like parts of one system.",
          "A consistent email signature should include the sender’s name, role, business name, primary phone number, website, and any essential booking information. Keep it simple enough to read on mobile.",
        ],
      },
      {
        heading: "Set it up as business infrastructure",
        paragraphs: [
          "Use a reputable email provider, enable multi-factor authentication, and keep recovery details under business control. Avoid building an important customer channel around one employee’s personal account.",
          "Document who owns the domain, who administers the email service, and how access can be recovered. These quiet safeguards matter when a staff member leaves or a device is lost.",
        ],
      },
    ],
    checklist: [
      "Use an address based on the business domain",
      "Choose inbox names customers will immediately understand",
      "Create a consistent, mobile-friendly email signature",
      "Enable multi-factor authentication for every account",
      "Keep domain and recovery access under business control",
    ],
    closing: "A professional email will not win a customer by itself, but it removes a reason for hesitation—and that is valuable.",
  },
  {
    slug: "website-as-calm-salesperson",
    category: "Website basics",
    title: "Your website is your calmest salesperson",
    summary: "A useful website explains, reassures, and guides customers without pressure—and keeps doing so when the business is closed.",
    image: "/images/journal/website-as-calm-salesperson.webp",
    imageAlt: "A clear business website answering questions and taking enquiries while the physical shop is closed",
    readTime: "6 min read",
    intro: "The best salesperson is not always the loudest. Often, it is the one who listens to the customer’s questions, explains the right information, and makes the next step feel easy. A good website can do exactly that.",
    sections: [
      {
        heading: "Start with the customer’s situation",
        paragraphs: [
          "Visitors arrive with a need, not a desire to study your company. Your opening message should help them recognize that they are in the right place. Name the problem you solve and the outcome you provide before telling the full company story.",
          "This does not require aggressive sales language. Clear, specific wording is enough: what you offer, who it helps, where you work, and what someone should do next.",
        ],
      },
      {
        heading: "Answer objections before they become barriers",
        paragraphs: [
          "Customers may wonder about price, timing, quality, location, experience, or what the process involves. Useful service pages address these concerns naturally through examples, FAQs, testimonials, process explanations, and sensible price guidance.",
          "The aim is not to answer every possible question. It is to remove the most common uncertainty so the customer can begin a productive conversation.",
        ],
      },
      {
        heading: "Guide rather than pressure",
        paragraphs: [
          "Every important page should have one clear next action. That might be booking a consultation, calling the shop, requesting directions, viewing a menu, or sending an enquiry. The wording should tell visitors what will happen, not merely say ‘Submit.’",
          "Too many competing buttons make the website feel uncertain. Prioritize the action that best matches the page and offer a quieter alternative only when it is genuinely useful.",
        ],
      },
      {
        heading: "Stay useful after launch",
        paragraphs: [
          "A salesperson needs current information, and so does a website. Review essential pages when prices, services, staff, hours, or policies change. Test forms and contact links regularly, especially after software updates.",
          "Use customer questions to improve the site. If the same question arrives every week, the answer probably belongs on the relevant page.",
        ],
      },
    ],
    checklist: [
      "A headline that reflects the customer’s need",
      "Service pages with practical details and expectations",
      "Proof through real work, reviews, credentials, or process",
      "One clear next action on every important page",
      "A regular check for outdated information and broken links",
    ],
    closing: "A calm website does not chase people. It gives the right customer enough clarity to move forward with confidence.",
  },
  {
    slug: "what-to-prepare-before-going-online",
    category: "Getting started",
    title: "What to prepare before going online",
    summary: "Gather the decisions, information, and assets that make an online launch faster, clearer, and easier to maintain.",
    image: "/images/journal/what-to-prepare-before-going-online.webp",
    imageAlt: "Organized logo files, business photos, services, prices, hours, contact details, domain, and website checklist",
    readTime: "6 min read",
    intro: "A successful online launch begins before design starts. The more clearly a business can explain what it does, who it serves, and how customers should respond, the stronger the finished presence will be.",
    sections: [
      {
        heading: "Clarify the business essentials",
        paragraphs: [
          "Write down the official business name, short description, services, location or service area, opening hours, phone numbers, and preferred contact methods. Confirm which details may be published and who approves changes.",
          "If different versions currently appear on signs, social accounts, or documents, choose one standard version. Consistency is much easier when the source information is settled first.",
        ],
      },
      {
        heading: "Understand the customer and the goal",
        paragraphs: [
          "Define the main customer in practical terms. What are they looking for? What do they need to know before contacting you? What might make them hesitate? These questions shape the page structure and content more effectively than design preferences alone.",
          "Choose a primary goal for the website: enquiries, bookings, visits, calls, applications, purchases, or simply trustworthy information. A clear goal helps every page lead somewhere useful.",
        ],
      },
      {
        heading: "Collect content with permission",
        paragraphs: [
          "Gather logos, brand colors, service descriptions, team biographies, product details, prices, policies, reviews, and photographs. Confirm that the business owns each asset or has permission to publish it.",
          "Real photographs are especially valuable for local businesses. Prioritize clear images of the storefront, team, environment, products, and completed work over a large collection of generic stock images.",
        ],
      },
      {
        heading: "Assign ownership for the future",
        paragraphs: [
          "Decide who will own the domain, hosting, email accounts, Google profile, analytics, and social accounts. Record administrative access in a secure business-controlled location rather than leaving it with one person or supplier.",
          "Also decide who will approve future updates and how frequently key information should be reviewed. A launch is stronger when maintenance has an owner from the beginning.",
        ],
      },
    ],
    checklist: [
      "Confirmed business name, hours, location, and contact routes",
      "A clear primary customer and website goal",
      "Approved service descriptions, prices, policies, and reviews",
      "Owned or licensed logos and photographs",
      "Business-controlled access to domains and platform accounts",
    ],
    closing: "Preparation does not remove every decision from a project. It makes the important decisions visible early, when they are easiest to solve.",
  },
  {
    slug: "consistency-builds-trust",
    category: "Consistency",
    title: "Consistency builds trust across every channel",
    summary: "When every channel tells the same clear story, customers spend less time checking and more time deciding.",
    image: "/images/journal/consistency-builds-trust.webp",
    imageAlt: "Bakery owner reviewing matching branding and business information across laptop, tablet, phone, packaging, and storefront",
    readTime: "5 min read",
    intro: "Customers rarely see only one part of a business. They may move from Google to Instagram, from a website to Messenger, or from a printed card back to Maps. Consistency helps that journey feel dependable.",
    sections: [
      {
        heading: "Begin with factual consistency",
        paragraphs: [
          "The business name, address, phone number, opening hours, website, and service area should match everywhere. These details affect both customer confidence and the ability of search platforms to understand the business.",
          "Create one approved reference document and use it whenever a profile is created or updated. This prevents small variations from spreading across channels over time.",
        ],
      },
      {
        heading: "Make the promise recognizable",
        paragraphs: [
          "Consistency is also about meaning. A customer should encounter the same core description of what you do and why it is useful, even when each platform requires different wording or formats.",
          "Do not copy every sentence everywhere. Adapt the message to the channel while preserving the same offer, priorities, and tone. Recognition matters more than repetition.",
        ],
      },
      {
        heading: "Use visual continuity with restraint",
        paragraphs: [
          "A stable logo, color palette, type style, and photography approach help customers recognize the business. Simple rules applied consistently are more effective than a complex identity used irregularly.",
          "Keep profile images legible at small sizes, use current cover imagery, and avoid changing the visual direction simply to follow every trend. Familiarity is part of trust.",
        ],
      },
      {
        heading: "Create a practical review rhythm",
        paragraphs: [
          "Review the website, Google profile, and core social accounts whenever hours, prices, services, locations, or contact details change. Add a quarterly check even when no major change is expected.",
          "Assign one person to own the source information and record when profiles were last reviewed. Consistency becomes manageable when it is a small routine rather than an occasional rescue project.",
        ],
      },
    ],
    checklist: [
      "One approved version of the business’s essential details",
      "A short core description adapted for each platform",
      "Consistent logo, colors, and photography direction",
      "A clear owner for profile and website updates",
      "A quarterly review of all important public information",
    ],
    closing: "Consistency is quiet. Customers may never mention it, but they feel the confidence it creates.",
  },
  {
    slug: "complete-google-business-profile",
    category: "Local search",
    title: "The quiet power of a complete Google profile",
    summary: "A complete Google Business Profile helps nearby customers understand, trust, and reach your business at the moment they are searching.",
    image: "/images/journal/complete-google-business-profile.webp",
    imageAlt: "Complete local business profile with photos, reviews, hours, directions, phone, and website shown outside the matching cafe",
    readTime: "6 min read",
    intro: "For many local businesses, the Google Business Profile is more visible than the website. It appears when customers search by name, compare nearby options, request directions, check hours, or decide whether to call.",
    sections: [
      {
        heading: "Complete the information customers act on",
        paragraphs: [
          "Choose the most accurate primary category, then add the correct address or service area, phone number, website, opening hours, and relevant services. These details should match the information on your website.",
          "Use special hours for holidays and temporary changes rather than leaving customers to guess. Accuracy at the moment of a visit is one of the simplest ways to protect trust.",
        ],
      },
      {
        heading: "Show the real business",
        paragraphs: [
          "Add clear, current photographs of the exterior, entrance, interior, team, products, and completed work. Images help customers recognize the location and understand what kind of experience to expect.",
          "Avoid relying only on polished promotional graphics. Authentic photographs answer practical questions and often feel more credible to someone deciding where to go.",
        ],
      },
      {
        heading: "Treat reviews as a conversation",
        paragraphs: [
          "Invite genuine customers to leave reviews without offering rewards or controlling what they say. Make the process easy with a direct review link after a completed purchase or service.",
          "Respond to reviews calmly and specifically. Thank positive reviewers, acknowledge concerns, and move sensitive problem-solving into a private channel. The response is written for future customers as much as for the original reviewer.",
        ],
      },
      {
        heading: "Maintain the profile instead of setting and forgetting",
        paragraphs: [
          "Check suggested edits, messages, calls, website clicks, direction requests, and search terms regularly. These signals can reveal missing information and show how customers are trying to reach you.",
          "Google controls verification, approval, and some display decisions, so no provider can guarantee rankings. What the business can control is completeness, accuracy, relevance, and a reliable customer experience.",
        ],
      },
    ],
    checklist: [
      "The correct primary category and complete service information",
      "Accurate regular and special opening hours",
      "A matching website, phone number, address, or service area",
      "Recent, authentic photographs of the business",
      "A consistent process for requesting and responding to reviews",
    ],
    closing: "A complete profile does not shout. It quietly answers the right questions at the exact moment a nearby customer is ready to choose.",
  },
];
