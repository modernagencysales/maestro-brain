import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);

test("retrieves a cited Client Brain result through the installed CLI", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const marker = process.env.BRAIN_ACCEPTANCE_MARKER;
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!marker || !siteUrl)
    throw new Error("CLI acceptance environment missing");
  const clientName = "Brain V1 Acceptance";
  const keyName = `V1 CLI acceptance ${Date.now()}`;

  await page.goto("/clients");
  if (await page.getByRole("heading", { name: "Sign in" }).isVisible()) {
    const email = process.env.WORKOS_SMOKE_EMAIL;
    const password = process.env.WORKOS_SMOKE_PASSWORD;
    if (!email || !password)
      throw new Error("WorkOS smoke credentials missing");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("button", { name: "Continue with email" }).click();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in|continue/i }).click();
    await page.waitForURL((url) => url.pathname === "/clients");
  }

  await page.getByLabel("Active workspace").selectOption({ label: clientName });
  await page.goto("/settings");
  const createForm = page.getByRole("form", { name: "Create API key" });
  await createForm.getByLabel("Name").fill(keyName);
  await createForm
    .getByLabel("Expires at")
    .fill(String(Date.now() + 24 * 60 * 60 * 1_000));
  await createForm.getByRole("checkbox", { name: "Ask" }).check();
  await createForm.getByRole("button", { name: "Create API key" }).click();
  await expect(
    page.getByRole("heading", { name: "API key created" }),
  ).toBeVisible();
  const displayKey = await page.locator("code").innerText();

  try {
    const cli = process.env.MAESTRO_BRAIN_CLI ?? "maestro-brain";
    const env = {
      ...process.env,
      CONVEX_SITE_URL: siteUrl,
      MAESTRO_BRAIN_API_KEY: displayKey,
    };
    const search = await execFileAsync(
      cli,
      [
        "api",
        "call",
        "brain.sources.search",
        "--input",
        JSON.stringify({ query: marker }),
      ],
      { env },
    );
    const searchBody = JSON.parse(search.stdout) as {
      readonly ok: boolean;
      readonly result: {
        readonly results: readonly {
          readonly sourceRevisionKey: string;
          readonly citationKey: string;
          readonly excerpt: string;
        }[];
      };
    };
    expect(searchBody.ok).toBe(true);
    expect(searchBody.result.results[0]).toMatchObject({
      citationKey: expect.stringMatching(/^citation:/),
      excerpt: expect.stringContaining(marker),
    });

    const get = await execFileAsync(
      cli,
      [
        "api",
        "call",
        "brain.sources.get",
        "--input",
        JSON.stringify({
          sourceRevisionKey: searchBody.result.results[0]?.sourceRevisionKey,
        }),
      ],
      { env },
    );
    expect(JSON.parse(get.stdout)).toMatchObject({
      ok: true,
      result: { excerpt: expect.stringContaining(marker) },
    });

    const ask = await execFileAsync(
      cli,
      [
        "api",
        "call",
        "brain.answers.ask",
        "--input",
        JSON.stringify({ question: marker }),
      ],
      { env },
    );
    const askBody = JSON.parse(ask.stdout) as {
      readonly ok: boolean;
      readonly result: {
        readonly response: {
          readonly status: string;
          readonly evidence: readonly { readonly excerpt: string }[];
        };
      };
    };
    expect(askBody).toMatchObject({
      ok: true,
      result: { response: { status: "answered" } },
    });
    expect(askBody.result.response.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ excerpt: expect.stringContaining(marker) }),
      ]),
    );
  } finally {
    await page.getByRole("button", { name: "I have saved this key" }).click();
    const revokeForm = page.getByRole("form", { name: `Revoke ${keyName}` });
    await expect(revokeForm).toBeVisible();
    await revokeForm.getByRole("button", { name: "Revoke key" }).click();
    await expect(
      page.getByText(`${keyName} — revoked`, { exact: false }),
    ).toBeVisible();
  }
});
