import { expect, test } from "./support/fixtures";
import type { ContractsRuntime, ContractsScenario } from "./support/runtime";

test.setTimeout(120_000);

type BrainPage = Readonly<{
  _id: string;
  title: string;
  markdown: string;
  updatedAt: number;
}>;

const commandArgs = (
  operationId: string,
  workspace: string,
  input: Record<string, unknown>,
  idempotencyKey?: string,
) => [
  "capability",
  "run",
  operationId,
  "--workspace",
  workspace,
  "--input",
  JSON.stringify(input),
  ...(idempotencyKey === undefined
    ? []
    : ["--idempotency-key", idempotencyKey]),
];

const cliResult = <Result>(stdout: string): Result => {
  const payload: unknown = JSON.parse(stdout);
  if (
    payload === null ||
    typeof payload !== "object" ||
    !("ok" in payload) ||
    payload.ok !== true ||
    !("result" in payload)
  ) {
    throw new Error("Brain CLI response was invalid.");
  }
  return payload.result as Result;
};

const createPage = async (
  runtime: ContractsRuntime,
  scenario: ContractsScenario,
  title: string,
  actor: "primary" | "observer" = "primary",
) => {
  const workspace =
    actor === "primary"
      ? scenario.workspaceSlug
      : scenario.observerWorkspaceSlug;
  return cliResult<string>(
    await runtime.runCli(
      scenario,
      commandArgs(
        "brain.pages.createMarkdown",
        workspace,
        {
          slug: title.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-"),
          title,
          markdown: `# ${title}\n\nInitial company context.`,
        },
        `${scenario.namespace}-create-${actor}-${title}`,
      ),
      actor,
    ),
  );
};

const getPage = async (
  runtime: ContractsRuntime,
  scenario: ContractsScenario,
  pageId: string,
) =>
  cliResult<BrainPage>(
    await runtime.runCli(
      scenario,
      commandArgs("brain.pages.get", scenario.workspaceSlug, { pageId }),
    ),
  );

test(
  "the complete Inbox screen lists only the active workspace Brain pages",
  { tag: "@BHV-BRAIN-001-R1" },
  async ({ acceptancePage: page, runtime, scenario }) => {
    const title = `Primary Brain ${scenario.namespace}`;
    const otherTitle = `Other Brain ${scenario.namespace}`;
    const pageId = await createPage(runtime, scenario, title);
    await createPage(runtime, scenario, otherTitle, "observer");

    await page.goto(`${runtime.webUrl}/${scenario.workspaceSlug}/inbox`);
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(otherTitle, { exact: true })).toHaveCount(0);
    await page.getByText(title, { exact: true }).first().click();
    await expect(page.getByLabel("Agency Brain page editor")).toBeVisible();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(pageId));
  },
);

test(
  "a revision-fenced Brain edit persists across web CLI and HTTP",
  { tag: "@BHV-BRAIN-002-R1" },
  async ({ acceptancePage: page, runtime, scenario }) => {
    const title = `Editable Brain ${scenario.namespace}`;
    const pageId = await createPage(runtime, scenario, title);
    const initial = await getPage(runtime, scenario, pageId);
    const uniqueText = `Approved positioning ${scenario.namespace}`;

    await page.goto(`${runtime.webUrl}/${scenario.workspaceSlug}/inbox`);
    await page.getByText(title, { exact: true }).first().click();
    const contentEditable = page
      .getByLabel("Agency Brain page editor")
      .locator('[contenteditable="true"]');
    await expect(contentEditable).toBeVisible();
    await contentEditable.fill(uniqueText);

    let current: BrainPage = initial;
    await expect
      .poll(async () => {
        current = await getPage(runtime, scenario, pageId);
        return current.markdown;
      })
      .toContain(uniqueText);

    const httpPage = (await runtime.runApi(scenario, "brain.pages.get", {
      pageId,
    })) as { ok: true; result: BrainPage };
    expect(httpPage.ok).toBe(true);
    expect(httpPage.result.markdown).toBe(current.markdown);
    expect(httpPage.result.updatedAt).toBe(current.updatedAt);

    await expect(
      runtime.runCli(
        scenario,
        commandArgs(
          "brain.pages.updateMarkdown",
          scenario.workspaceSlug,
          {
            pageId,
            markdown: "stale overwrite",
            expectedUpdatedAt: initial.updatedAt,
          },
          `${scenario.namespace}-stale-update`,
        ),
      ),
    ).rejects.toThrow();
    const afterStale = await getPage(runtime, scenario, pageId);
    expect(afterStale.markdown).toBe(current.markdown);
    expect(afterStale.updatedAt).toBe(current.updatedAt);
  },
);
