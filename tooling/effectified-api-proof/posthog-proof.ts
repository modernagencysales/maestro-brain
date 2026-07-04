import { PostHog } from "@posthog/convex";

declare const component: ConstructorParameters<typeof PostHog>[0];
const posthog = new PostHog(component);

declare const ctx: Parameters<typeof posthog.capture>[0];
void posthog.capture(ctx, {
  distinctId: "proof",
  event: "template.proof",
  properties: { source: "effectified-api-proof" },
});
