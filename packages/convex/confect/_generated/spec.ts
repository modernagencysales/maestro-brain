import { GroupSpec, Spec } from "@confect/core";
import auth_workspaces from "../auth/workspaces.spec";
import brain_pages from "../brain/pages.spec";
import capabilities_catalog from "../capabilities/catalog.spec";

const spec: Spec.Spec<
  | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "auth", never, GroupSpec.NamedAt<typeof auth_workspaces, "workspaces">>, "auth">
  | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "brain", never, GroupSpec.NamedAt<typeof brain_pages, "pages">>, "brain">
  | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "capabilities", never, GroupSpec.NamedAt<typeof capabilities_catalog, "catalog">>, "capabilities">
> = Spec.make().addAt("auth", GroupSpec.makeAt("auth").addGroupAt("workspaces", auth_workspaces)).addAt("brain", GroupSpec.makeAt("brain").addGroupAt("pages", brain_pages)).addAt("capabilities", GroupSpec.makeAt("capabilities").addGroupAt("catalog", capabilities_catalog));

export default spec;
