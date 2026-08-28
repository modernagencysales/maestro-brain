import { expect, test } from "./support/fixtures";
import type { ContractsRuntime, ContractsScenario } from "./support/runtime";

test.setTimeout(180_000);

// Source-mode acceptance compiles the complete purchased Contacts and Inbox
// compositions on demand. Preserve the exact UI/data assertions while allowing
// the measured cold route to finish loading before declaring data absent.
const COLD_BRAIN_OBSERVATION_TIMEOUT_MS = 60_000;

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
  actor: "primary" | "client" | "observer" = "primary",
  markdown = `# ${title}\n\nInitial company context.`,
) => {
  const workspace =
    actor === "primary"
      ? scenario.workspaceSlug
      : actor === "client"
        ? scenario.clientWorkspaceSlug
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
          markdown,
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
      commandArgs(
        "brain.pages.get",
        scenario.workspaceSlug,
        { pageId },
        `${scenario.namespace}-get-${pageId}`,
      ),
    ),
  );

test(
  "the complete Inbox screen lists only the active workspace Brain pages",
  { tag: "@BHV-BRAIN-001-R1" },
  async ({ acceptancePage: page, runtime, scenario }) => {
    const title = `Primary Brain ${scenario.namespace}`;
    const otherTitle = `Other Brain ${scenario.namespace}`;
    const pageId = await createPage(runtime, scenario, title);
    await page.goto(`${runtime.webUrl}/${scenario.workspaceSlug}/inbox`);
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({
      timeout: COLD_BRAIN_OBSERVATION_TIMEOUT_MS,
    });
    await expect(page.getByText(otherTitle, { exact: true })).toHaveCount(0);
    await page.getByText(title, { exact: true }).first().click();
    await expect(page.getByLabel("Agency Brain page editor")).toBeVisible({
      timeout: COLD_BRAIN_OBSERVATION_TIMEOUT_MS,
    });
    const navigatorBounds = await page
      .getByRole("region", { name: "Brain page tree" })
      .boundingBox();
    const editorBounds = await page
      .getByLabel("Agency Brain page editor")
      .boundingBox();
    expect(navigatorBounds).not.toBeNull();
    expect(editorBounds).not.toBeNull();
    expect(editorBounds?.x ?? 0).toBeGreaterThan(
      (navigatorBounds?.x ?? 0) + (navigatorBounds?.width ?? 0) - 2,
    );
    expect(editorBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      (navigatorBounds?.y ?? 0) + 200,
    );
    expect(navigatorBounds?.height ?? 0).toBeGreaterThan(500);
    await expect(
      page
        .getByRole("navigation", { name: "breadcrumb" })
        .getByText(title, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Page" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(pageId));
  },
);

test(
  "Ask Maestro returns the same cited evidence through Search CLI and HTTP",
  { tag: "@BHV-BRAIN-003-R1" },
  async ({ acceptancePage: page, runtime, scenario }) => {
    const title = `Launch evidence ${scenario.namespace}`;
    const fact = `Project ${scenario.namespace} launches on Friday.`;
    const question = `When does project ${scenario.namespace} launch?`;
    await createPage(runtime, scenario, title, "primary", fact);

    const cliAnswer = cliResult<{
      answerMarkdown: string;
      contextPack: {
        citations: readonly { sourceRevisionId: string; title: string }[];
      };
    }>(
      await runtime.runCli(
        scenario,
        commandArgs(
          "agents.assistant.answerQuestion",
          scenario.workspaceSlug,
          { question },
          `${scenario.namespace}-ask-cli`,
        ),
      ),
    );
    const httpAnswer = (await runtime.runApi(
      scenario,
      "agents.assistant.answerQuestion",
      { question },
    )) as {
      ok: true;
      result: typeof cliAnswer;
    };

    expect(httpAnswer.ok).toBe(true);
    expect(httpAnswer.result.answerMarkdown).toBe(cliAnswer.answerMarkdown);
    expect(
      httpAnswer.result.contextPack.citations.map(
        ({ sourceRevisionId }) => sourceRevisionId,
      ),
    ).toEqual(
      cliAnswer.contextPack.citations.map(
        ({ sourceRevisionId }) => sourceRevisionId,
      ),
    );
    expect(cliAnswer.answerMarkdown).toContain("Friday");

    await page.goto(`${runtime.webUrl}/${scenario.workspaceSlug}/search`);
    await page.getByPlaceholder("Ask Maestro anything...").fill(question);
    await expect(page.getByText(/Friday/u).first()).toBeVisible();
    await expect(page.getByText(new RegExp(title, "u")).first()).toBeVisible();
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
    await expect(contentEditable).toBeVisible({
      timeout: COLD_BRAIN_OBSERVATION_TIMEOUT_MS,
    });
    await contentEditable.fill(uniqueText);

    let current: BrainPage = initial;
    await expect
      .poll(
        async () => {
          current = await getPage(runtime, scenario, pageId);
          return current.markdown;
        },
        { timeout: COLD_BRAIN_OBSERVATION_TIMEOUT_MS },
      )
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

test(
  "the complete connection cards manage the durable provider lifecycle",
  { tag: "@BHV-BRAIN-004-R1" },
  async ({ acceptancePage: page, runtime, scenario }) => {
    await page.goto(`${runtime.webUrl}/${scenario.workspaceSlug}/`);

    await expect(page.getByRole("heading", { name: "Slack" })).toBeVisible({
      timeout: COLD_BRAIN_OBSERVATION_TIMEOUT_MS,
    });
    await expect(
      page.getByText("Available integration", { exact: true }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();

    type ConnectionListResponse = {
      ok: true;
      result: readonly {
        provider: string;
        status: string;
        generation: number;
      }[];
    };
    let connected: ConnectionListResponse = { ok: true, result: [] };
    await expect
      .poll(async () => {
        connected = (await runtime.runApi(
          scenario,
          "integrations.connections.list",
          {},
        )) as ConnectionListResponse;
        return connected.result.find(({ provider }) => provider === "slack")
          ?.status;
      })
      .toBe("active");
    expect(connected.result).toContainEqual(
      expect.objectContaining({ provider: "slack", status: "active" }),
    );
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(
      page.getByText("Available integration", { exact: true }).first(),
    ).toBeVisible();

    let revoked: ConnectionListResponse = { ok: true, result: [] };
    await expect
      .poll(async () => {
        revoked = (await runtime.runApi(
          scenario,
          "integrations.connections.list",
          {},
        )) as ConnectionListResponse;
        return revoked.result.find(({ provider }) => provider === "slack")
          ?.status;
      })
      .toBe("revoked");
    expect(revoked.result).toContainEqual(
      expect.objectContaining({ provider: "slack", status: "revoked" }),
    );
  },
);

test(
  "the complete Contacts screens switch into an authorized client Brain",
  { tag: "@BHV-BRAIN-005-R1" },
  async ({ acceptancePage: page, runtime, scenario }) => {
    const agencyTitle = `Agency boundary ${scenario.namespace}`;
    const clientTitle = `Client boundary ${scenario.namespace}`;
    await createPage(runtime, scenario, agencyTitle);
    await createPage(runtime, scenario, clientTitle, "client");

    await page.goto(`${runtime.webUrl}/${scenario.workspaceSlug}/contacts`);
    const clientName = `Client ${scenario.namespace}`;
    await expect(page.getByText(clientName, { exact: true })).toBeVisible({
      timeout: COLD_BRAIN_OBSERVATION_TIMEOUT_MS,
    });
    await expect(page.getByText(`Contracts observer`)).toHaveCount(0);

    await page.getByText(clientName, { exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${scenario.clientWorkspaceSlug}/inbox$`, "u"),
    );
    await expect(
      page.getByText(clientTitle, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(agencyTitle, { exact: true })).toHaveCount(0);

    await page.goto(`${runtime.webUrl}/unauthorized-workspace/inbox`);
    await expect(page.getByText("This workspace does not exist")).toBeVisible({
      timeout: COLD_BRAIN_OBSERVATION_TIMEOUT_MS,
    });
  },
);
