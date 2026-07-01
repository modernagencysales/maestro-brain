const input = await new Promise<string>((resolve) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    data += chunk;
  });
  process.stdin.on("end", () => resolve(data));
});

const pass =
  /verdict\s*=\s*pass/i.test(input) || /"verdict"\s*:\s*"pass"/i.test(input);

if (!pass) {
  console.error("extract-ai-verdict: missing parseable pass verdict");
  process.exitCode = 1;
} else {
  console.log("extract-ai-verdict: pass");
}
