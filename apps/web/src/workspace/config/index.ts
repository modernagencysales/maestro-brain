import type { BillingPlan } from "@saas-ui-pro/billing";

export const segments = {} as const;
export const plans: BillingPlan[] = [];
export const features: Array<{
  id: string;
  label: string;
  description?: string;
}> = [];
export const config = {
  appName: "Maestro Template",
  billing: { enabled: false },
} as const;
