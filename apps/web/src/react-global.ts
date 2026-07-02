import * as React from "react";

type ReactGlobal = typeof globalThis & {
  React?: typeof React;
};

const reactGlobal = globalThis as ReactGlobal;

reactGlobal.React ??= React;
