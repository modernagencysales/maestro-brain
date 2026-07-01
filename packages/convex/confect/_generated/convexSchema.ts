import { defineSchema as $defineSchema } from "convex/server";

import brainPages from "./tables/brainPages";
import workspaces from "./tables/workspaces";

export default $defineSchema({
  brainPages: brainPages.tableDefinition,
  workspaces: workspaces.tableDefinition,
});
