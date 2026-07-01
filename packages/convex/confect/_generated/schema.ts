import { DatabaseSchema as $DatabaseSchema } from "@confect/server";

import brainPages from "./tables/brainPages";
import workspaces from "./tables/workspaces";

const databaseSchema: $DatabaseSchema.DatabaseSchema<
  typeof brainPages |
  typeof workspaces
> = $DatabaseSchema.make({
  brainPages,
  workspaces,
});

export default databaseSchema;
