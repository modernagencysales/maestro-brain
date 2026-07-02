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

const VERDICT_MARKER_PREFIXES = [
  "TASTE_VERDICT_JSON=",
  "CONTRACT_VERDICT_JSON=",
] as const;

// A gate-emitted VERDICT_JSON marker is authoritative over loose "verdict=pass"
// text elsewhere in the log: a blocking or unparseable marker fails closed even
// when surrounding log lines look like a pass.
function lastMarkerVerdict(input: string): AiVerdictParseResult | null {
  let lastMarkerJson: string | null = null;
  for (const line of input.split("\n")) {
    for (const prefix of VERDICT_MARKER_PREFIXES) {
      if (line.startsWith(prefix)) {
        lastMarkerJson = line.slice(prefix.length).trim();
      }
    }
  }
  if (lastMarkerJson === null) return null;

  try {
    const parsed = JSON.parse(lastMarkerJson) as unknown;
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
  return { ok: false, reason: "blocking or unparseable AI gate verdict" };
}

export function parseAiVerdict(input: string): AiVerdictParseResult {
  const trimmed = input.trim();

  const markerResult = lastMarkerVerdict(trimmed);
  if (markerResult !== null) return markerResult;

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
