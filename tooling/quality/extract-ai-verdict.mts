import { isDirectRun } from "./src/direct-run.mts";

export type AiVerdictParseResult =
  | {
      readonly ok: true;
      readonly verdict: "pass";
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export function parseAiVerdict(input: string): AiVerdictParseResult {
  const trimmed = input.trim();

  if (/verdict\s*=\s*pass/i.test(trimmed)) {
    return { ok: true, verdict: "pass" };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "verdict" in parsed &&
      parsed.verdict === "pass"
    ) {
      return { ok: true, verdict: "pass" };
    }
  } catch {
    // Fall through to the shared fail-closed result.
  }

  return { ok: false, reason: "missing parseable pass verdict" };
}

async function readStdin(): Promise<string> {
  return await new Promise<string>((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

export async function runExtractAiVerdict(): Promise<void> {
  const result = parseAiVerdict(await readStdin());

  if (!result.ok) {
    console.error(`extract-ai-verdict: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  console.log("extract-ai-verdict: pass");
}

if (isDirectRun(import.meta.url)) await runExtractAiVerdict();
