import { RtkCommandError, runRtk } from "./process.js";

export const inspectLaneGreenAuthorityFabroRun = (
  target: string,
  env: NodeJS.ProcessEnv = process.env,
): unknown => {
  try {
    return JSON.parse(
      runRtk(["fabro", "inspect", target, "--json", "--quiet"], {
        env,
        quiet: true,
      }),
    );
  } catch (error) {
    const noRun = `No run found matching '${target}'`;
    if (error instanceof RtkCommandError && error.output === noRun) {
      throw new Error(noRun, { cause: error });
    }
    throw error;
  }
};
