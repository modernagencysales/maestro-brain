import { pathToFileURL } from "node:url";

export type HostedWorkerCanaryResult = {
  readonly ok: true;
  readonly origin: string;
  readonly routes: readonly string[];
  readonly assetPath: string;
};

const requiredRoutes = ["/", "/login", "/brain"] as const;
const expectedTitles = {
  "/": "Maestro Brain",
  "/login": "Login",
  "/brain": "Maestro Brain",
} as const satisfies Record<(typeof requiredRoutes)[number], string>;

const requireHostedOrigin = (value: string | undefined): URL => {
  if (!value) throw new Error("TEMPLATE_HOSTED_URL is required");
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error("TEMPLATE_HOSTED_URL must use HTTPS");
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error("TEMPLATE_HOSTED_URL must be an origin URL");
  return url;
};

const fetchOk = async (
  fetchImpl: typeof fetch,
  url: URL,
): Promise<Response> => {
  const response = await fetchImpl(url, {
    redirect: "error",
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok)
    throw new Error(
      `Hosted canary received HTTP ${response.status} for ${url}`,
    );
  return response;
};

const validateHostedHtml = async (
  route: (typeof requiredRoutes)[number],
  response: Response,
): Promise<string> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html"))
    throw new Error(`Hosted canary expected HTML for ${route}`);
  const html = await response.text();
  if (!/<html\s+lang=["']en["']/iu.test(html))
    throw new Error(
      `Hosted canary found no English document shell for ${route}`,
    );
  if (!html.includes(`<title>${expectedTitles[route]}</title>`))
    throw new Error(`Hosted canary found the wrong product shell for ${route}`);
  const match = /(?:src|href)=["'](\/assets\/[^"']+)["']/u.exec(html);
  if (!match?.[1])
    throw new Error(`Hosted canary found no built asset link for ${route}`);
  if (/HTTPError|Internal Server Error|unhandled[^<]{0,20}true/iu.test(html))
    throw new Error(`Hosted canary found an error payload for ${route}`);
  return match[1];
};

const validateHostedAsset = async (
  fetchImpl: typeof fetch,
  origin: URL,
  assetPath: string,
): Promise<void> => {
  const response = await fetchImpl(new URL(assetPath, origin), {
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      `Hosted canary received HTTP ${response.status} for ${assetPath}`,
    );
  const contentType = response.headers.get("content-type") ?? "";
  if (!/(?:javascript|text\/css|font|image)/iu.test(contentType))
    throw new Error(
      `Hosted canary received an invalid asset type for ${assetPath}`,
    );
};

export const runHostedWorkerCanary = async (input: {
  readonly hostedUrl: string | undefined;
  readonly fetchImpl?: typeof fetch;
}): Promise<HostedWorkerCanaryResult> => {
  const origin = requireHostedOrigin(input.hostedUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  let assetPath: string | undefined;

  for (const route of requiredRoutes) {
    const response = await fetchOk(fetchImpl, new URL(route, origin));
    const routeAssetPath = await validateHostedHtml(route, response);
    assetPath ??= routeAssetPath;
  }

  if (!assetPath) throw new Error("Hosted canary found no asset to probe");
  await validateHostedAsset(fetchImpl, origin, assetPath);

  return {
    ok: true,
    origin: origin.origin,
    routes: requiredRoutes,
    assetPath,
  };
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await runHostedWorkerCanary({
    hostedUrl: process.env.TEMPLATE_HOSTED_URL,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
