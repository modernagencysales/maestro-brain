import migrations from "@convex-dev/migrations/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import workpool from "@convex-dev/workpool/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();

app.use(workpool, { name: "workpool" });
app.use(workflow, { name: "workflow" });
app.use(migrations, { name: "migrations" });

export default app;
