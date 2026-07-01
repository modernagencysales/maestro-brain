import "@xyflow/react/dist/style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./sample/App";
import "./sample/styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
