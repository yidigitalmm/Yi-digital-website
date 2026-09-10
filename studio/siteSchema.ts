import { defineType, defineField, defineArrayMember } from "sanity";
import { businessDefaults } from "../src/cms/siteDefaults";
const title = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
export const siteSchema = [
  defineType({ name: "sitePage", title: "Page content", type: "document",
    fields: [defineField({ name: "title", type: "string", readOnly: true }),
      defineField({ name: "entries", title: "Page text", description: "Open a row to edit English and Myanmar. Leave Myanmar empty to use English. The existing page structure stays fixed.", type: "array", options: { sortable: false, disableActions: ["add", "remove", "duplicate", "copy"] }, of: [defineArrayMember({ type: "object", name: "siteText",
        fields: [defineField({ name: "key", type: "string", hidden: true, readOnly: true }), defineField({ name: "label", type: "string", hidden: true, readOnly: true }), defineField({ name: "kind", type: "string", hidden: true, readOnly: true }),
          defineField({ name: "en", title: "English", type: "text", rows: 3, hidden: ({ parent }) => parent?.kind !== "string", validation: rule => rule.custom((value, context) => (context.parent as { kind?: string })?.kind === "string" && (typeof value !== "string" || !value.trim()) ? "English text is required." : true) }),
          defineField({ name: "my", title: "Myanmar", type: "text", rows: 3, hidden: ({ parent }) => parent?.kind !== "string" }),
          defineField({ name: "enBoolean", title: "Enabled in English", type: "boolean", hidden: ({ parent }) => parent?.kind !== "boolean" }),
          defineField({ name: "myBoolean", title: "Enabled in Myanmar", type: "boolean", hidden: ({ parent }) => parent?.kind !== "boolean" }),
          defineField({ name: "enNumber", title: "English value", type: "number", hidden: ({ parent }) => parent?.kind !== "number" }),
          defineField({ name: "myNumber", title: "Myanmar value", type: "number", hidden: ({ parent }) => parent?.kind !== "number" })],
        preview: { select: { title: "label", subtitle: "en" } },
      })] })], preview: { select: { title: "title" } },
  }),
  defineType({ name: "siteBusiness", title: "Contact & social links", type: "document",
    fields: Object.keys(businessDefaults).map(name => defineField({ name, title: title(name), type: "string",
      description: name === "email" ? "Public contact link only. Enquiry delivery is configured separately on the server." : name.endsWith("Number") ? "International format, starting with +. Used for click-to-call or chat." : undefined,
      validation: rule => rule.required().custom(value => {
        if (typeof value !== "string") return true;
        if (["facebook", "instagram", "tiktok", "linkedin"].includes(name) && !/^https:\/\//.test(value)) return "Use an HTTPS URL.";
        if (name === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email address.";
        if (name.endsWith("Number") && !/^\+[0-9]{6,15}$/.test(value)) return "Use + followed by 6–15 digits.";
        return true;
      }) })), preview: { prepare: () => ({ title: "Contact & social links" }) },
  }),
  defineType({ name: "siteMedia", title: "Website images", type: "document",
    fields: [defineField({ name: "items", title: "Images & logos", description: "Replace images in their existing locations. Keep similar dimensions, especially for animation layers and logos.", type: "array", options: { sortable: false, disableActions: ["add", "remove", "duplicate", "copy"] }, of: [defineArrayMember({ type: "object", name: "siteImage", fields: [
      defineField({ name: "key", type: "string", hidden: true, readOnly: true }),
      defineField({ name: "label", title: "Used for", type: "string", readOnly: true }),
      defineField({ name: "image", title: "Image", type: "image", validation: rule => rule.required() }),
    ], preview: { select: { title: "label", media: "image" } } })] })], preview: { prepare: () => ({ title: "Website images" }) },
  }),
];
