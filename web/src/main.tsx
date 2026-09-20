import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerServiceWorker } from "./pwa/register";
import "./styles/app.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root is missing from index.html");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Registered after the app has mounted, not before.
 *
 * The worker only matters on the NEXT load, so competing for bandwidth with the
 * first one buys nothing. The update handler only records that a new version is
 * waiting - activating it would swap the code out from under whatever the user is
 * doing, so the reload stays theirs to make.
 */
registerServiceWorker({
  onUpdateReady: () => {
    document.body.dataset["updateReady"] = "true";
  },
});
