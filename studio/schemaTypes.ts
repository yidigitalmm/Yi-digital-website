import { defineArrayMember, defineField, defineType } from "sanity";

const text = (name: string, title: string, multiline = false) => defineField({
  name, title, type: multiline ? "text" : "string", validation: rule => rule.required(),
});
const strings = (name: string, title: string) => defineField({ name, title, type: "array", of: [defineArrayMember({ type: "string" })] });
const articleText = defineType({
  name: "articleText", title: "Article text", type: "object",
  fields: [text("title", "Title"), text("category", "Category"), text("summary", "Summary", true),
    text("imageAlt", "Image description"), text("readTime", "Reading time"), text("intro", "Introduction", true),
    defineField({ name: "sections", title: "Sections", type: "array", validation: rule => rule.required().min(1), of: [defineArrayMember({
      type: "object", name: "articleSection", fields: [text("heading", "Heading"),
        defineField({ name: "paragraphs", title: "Paragraphs", type: "array", of: [{ type: "text" }], validation: rule => rule.required().min(1) })],
      preview: { select: { title: "heading" } },
    })] }), strings("checklist", "Checklist"), text("closing", "Closing paragraph", true)],
});
const projectText = defineType({
  name: "projectText", title: "Project text", type: "object",
  fields: [text("title", "Project name"), text("type", "Business type"), text("summary", "Summary", true),
    text("packageName", "Package selected"), strings("addons", "Add-ons"), strings("delivered", "What we delivered"), text("outcome", "Outcome", true)],
});
const languages = (type: string) => [
  defineField({ name: "en", title: "English", type, group: "en", validation: rule => rule.required() }),
  defineField({ name: "my", title: "Myanmar", type, group: "my", description: "Optional. Leave empty to display English until the translation is ready." }),
];
const groups = [{ name: "details", title: "Details", default: true }, { name: "en", title: "English" }, { name: "my", title: "Myanmar" }];
const order = defineField({ name: "order", title: "Display order", type: "number", group: "details", initialValue: 100, validation: rule => rule.required().integer().min(0), description: "Lower numbers appear first. The first article is featured." });
const image = defineField({ name: "image", title: "Cover image", type: "image", group: "details", validation: rule => rule.required() });
const preview = { select: { title: "en.title", media: "image" } };
const orderings = [{ title: "Display order", name: "displayOrder", by: [{ field: "order", direction: "asc" as const }] }];

export const schemaTypes = [articleText, projectText,
  defineType({ name: "contentSetup", title: "Content setup", type: "document", readOnly: true,
    fields: [defineField({ name: "initialized", type: "boolean" })],
  }),
  defineType({ name: "journalArticle", title: "Journal article", type: "document", groups, preview, orderings,
    fields: [order, defineField({ name: "slug", title: "Article URL", type: "slug", group: "details", options: { source: "en.title" },
      validation: rule => rule.required().custom(value => !value?.current || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.current) ? true : "Use lowercase English letters, numbers and hyphens."),
      description: "Shared by both languages. Changing a published URL breaks existing links." }), image, ...languages("articleText")],
  }),
  defineType({ name: "workProject", title: "Work project", type: "document", groups, preview, orderings,
    fields: [order, image,
      defineField({ name: "websitePreview", title: "Scrollable website screenshot", type: "boolean", group: "details", initialValue: false }),
      defineField({ name: "scrollImage", title: "Full website screenshot", type: "image", group: "details" }),
      defineField({ name: "url", title: "Live website URL", type: "url", group: "details", validation: rule => rule.uri({ scheme: ["https", "http"] }) }),
      ...languages("projectText")],
  }),
];
