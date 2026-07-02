export type TemplateHealthEnvironment = "fake" | "test" | "live";

export type TemplateHealthCheck = {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail";
  readonly detail: string;
};

export type TemplateHealthReportValue = {
  readonly ok: boolean;
  readonly service: "maestro-template";
  readonly environment: TemplateHealthEnvironment;
  readonly commitSha: string;
  readonly checkedAt: number;
  readonly checks: readonly TemplateHealthCheck[];
};

export const buildTemplateHealthReport = (input: {
  readonly environment: TemplateHealthEnvironment;
  readonly commitSha: string;
  readonly checkedAt: number;
}): TemplateHealthReportValue => {
  const checks: readonly TemplateHealthCheck[] = [
    { id: "runtime", status: "pass", detail: "process is responsive" },
    { id: "confect", status: "pass", detail: "health group registered" },
    input.environment === "fake"
      ? {
          id: "providers",
          status: "pass",
          detail: "fake providers do not require live secrets",
        }
      : {
          id: "providers",
          status: "warn",
          detail: "verify provider credentials through deploy doctor",
        },
  ];

  return {
    ok: checks.every((check) => check.status !== "fail"),
    service: "maestro-template",
    environment: input.environment,
    commitSha: input.commitSha,
    checkedAt: input.checkedAt,
    checks,
  };
};
