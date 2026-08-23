import migrations from "@convex-dev/migrations/convex.config";
import agent from "@convex-dev/agent/convex.config";
import prosemirrorSync from "@convex-dev/prosemirror-sync/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config";
import posthog from "@posthog/convex/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    POSTHOG_PROJECT_TOKEN: v.string(),
    POSTHOG_HOST: v.optional(v.string()),
    MAESTRO_CONTRACT_TEST: v.optional(v.literal("1")),
    PROMOTION_AUTHORITY_MODE: v.optional(v.literal("authority")),
    PROMOTION_AUTHORITY_PRIVATE_KEY_PKCS8_BASE64URL: v.optional(v.string()),
  },
});

app.use(posthog, {
  env: {
    POSTHOG_PROJECT_TOKEN: app.env.POSTHOG_PROJECT_TOKEN,
    POSTHOG_HOST: app.env.POSTHOG_HOST,
  },
});
app.use(agent, { name: "agent" });
app.use(workpool, { name: "workpool" });
app.use(migrations, { name: "migrations" });
app.use(prosemirrorSync);

export default app;
