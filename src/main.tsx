import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startMenuBridge } from "./state/menuBridge";
import "./styles.css";

// Phase 11: subscribe to native menu events from the Rust side. The
// bridge fan-outs back to the existing keyboard handlers / AppShell
// state, so the menu doesn't duplicate any command logic. In a
// non-Tauri environment (browser dev server) this resolves to null
// and the rest of the app keeps working.
void startMenuBridge();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
