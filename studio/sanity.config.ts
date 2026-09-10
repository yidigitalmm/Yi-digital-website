import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { projectId, dataset } from "./project";
import { schemaTypes } from "./schemaTypes";
import { siteSchema } from "./siteSchema";
import { pageDefinitions } from "../src/cms/siteDefaults";

export default defineConfig({
  name: "yi-digital",
  title: "Yi Digital",
  projectId, dataset,
  plugins: [structureTool({ structure: S => S.list().title("Website content").items([
    S.documentTypeListItem("journalArticle").title("Journal"),
    S.documentTypeListItem("workProject").title("Previous Work"),
    S.divider(),
    ...pageDefinitions.map(page => S.listItem().id(page.id).title(page.title).child(S.document().schemaType("sitePage").documentId(page.id).title(page.title))),
    S.listItem().id("site-business").title("Contact & social links").child(S.document().schemaType("siteBusiness").documentId("site-business")),
    S.listItem().id("site-media").title("Website images").child(S.document().schemaType("siteMedia").documentId("site-media")),
  ]) })],
  schema: { types: [...schemaTypes, ...siteSchema] },
  document: { actions: (actions, context) => ["sitePage", "siteBusiness", "siteMedia"].includes(context.schemaType) ? actions.filter(action => action.action !== "delete" && action.action !== "duplicate" && action.action !== "unpublish") : actions },
});
