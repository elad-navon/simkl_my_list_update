/**
 * The shell: providers, the setup gate, and which of the two screens is showing.
 *
 * The old app had no shell - `main()` decided what to draw by emptying `#app` and
 * writing new markup into it, which is why "go back from settings" had to be a
 * function that re-ran the whole render (`returnToPreviousView`, app.js:92-98).
 * Here the screen is state and going back is setting it.
 */

import { useCallback, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createCachePersister, createQueryClient, PERSIST_MAX_AGE } from "./query/client";
import { useBackend } from "./hooks/useBackend";
import { useLibraryLoad } from "./hooks/useLibraryLoad";
import { useLibrary } from "./library/store";
import { applyTheme, useSettings } from "./settings/store";
import { isConfigured, type Settings } from "./settings/schema";
import { Dashboard } from "./components/Dashboard";
import { SettingsScreen } from "./components/SettingsScreen";
import { TopBar } from "./components/TopBar";
import type { LibraryShow } from "./library/schema";

const queryClient = createQueryClient();
const persister = createCachePersister();

type Screen = "dashboard" | "settings";

function Shell(): React.JSX.Element {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const toggleTheme = useSettings((s) => s.toggleTheme);
  const toggleImageMode = useSettings((s) => s.toggleImageMode);

  const { backend, clients, requestedMode, unavailable } = useBackend();
  const { loading, report, error, reload } = useLibraryLoad(backend);
  const library = useLibrary((s) => s.library);
  const setImage = useLibrary((s) => s.setImage);

  // On first run there is no dashboard to show, so settings is the only screen.
  const configured = isConfigured(settings);
  const [screen, setScreen] = useState<Screen>(configured ? "dashboard" : "settings");

  const save = useCallback(
    (patch: Partial<Settings>) => {
      update(patch);
      setScreen("dashboard");
      // Changing the key or the source changes what every request would return,
      // so the load is redone rather than left showing the previous source's data.
      reload();
    },
    [update, reload],
  );

  const onSetImage = useCallback(
    (show: LibraryShow, mode: "poster" | "banner", path: string) => {
      void setImage(show.key, mode, path);
    },
    [setImage],
  );

  if (!configured || screen === "settings") {
    return (
      <>
        <TopBar
          imageMode={settings.imageMode}
          onToggleImageMode={toggleImageMode}
          onOpenSearch={() => setScreen("dashboard")}
          onOpenSettings={() => setScreen("settings")}
          settingsActive
          displayName={settings.displayName}
          avatarUrl={settings.avatarUrl}
        />
        <main className="main-content">
          <SettingsScreen
            settings={settings}
            onSave={save}
            onToggleTheme={toggleTheme}
            onClose={configured ? () => setScreen("dashboard") : null}
            // Both of these are phase 5 and 6 work. They are wired as no-ops
            // with a visible message rather than as dead buttons, so the screen
            // says what it cannot do yet instead of appearing to do it.
            onAuthorizeSimkl={() => window.alert("The SIMKL PIN flow lands with the next slice.")}
            onImportFromSimkl={null}
            onExportLibrary={() => exportLibrary(library)}
            onImportLibrary={() => window.alert("Importing a library file lands with the backup slice.")}
          />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar
        imageMode={settings.imageMode}
        onToggleImageMode={toggleImageMode}
        onOpenSearch={() => setScreen("dashboard")}
        onOpenSettings={() => setScreen("settings")}
        settingsActive={false}
        displayName={settings.displayName}
        avatarUrl={settings.avatarUrl}
      />

      <main className="main-content">
        <div className="page-header">
          <p id="subtitle">{subtitleFor({ loading, report, error, requestedMode, unavailable })}</p>
        </div>

        <Dashboard
          library={library}
          backend={backend}
          clients={clients}
          imageMode={settings.imageMode}
          onSetImage={onSetImage}
        />
      </main>
    </>
  );
}

/**
 * The line under the header, which is where the app explains itself.
 *
 * Deliberately specific. "Loading" tells you nothing about why a SIMKL load is
 * taking ten seconds, and an expired token looks identical to an empty list
 * unless something says otherwise.
 */
function subtitleFor(state: {
  loading: boolean;
  report: ReturnType<typeof useLibraryLoad>["report"];
  error: Error | null;
  requestedMode: string;
  unavailable: string | null;
}): string {
  if (state.unavailable === "simkl-not-authorized") {
    return "SIMKL is selected but not authorized - showing your local library. Open Settings to authorize.";
  }
  if (state.loading) {
    return state.requestedMode === "simkl" ? "Syncing with SIMKL…" : "Loading your library…";
  }
  if (state.error) {
    return `Could not reach SIMKL (${state.error.message}). Showing the local mirror.`;
  }
  if (!state.report) return "";

  const parts = [`${state.report.shows} shows`];
  if (state.report.refetched > 0) parts.push(`${state.report.refetched} refreshed`);
  if (state.report.removed > 0) parts.push(`${state.report.removed} removed`);
  if (state.report.unkeyed.length > 0) parts.push(`${state.report.unkeyed.length} unidentifiable`);
  return parts.join(" · ");
}

/** Downloads the library as JSON. The manual half of the backup safety net. */
function exportLibrary(library: unknown): void {
  const blob = new Blob([JSON.stringify(library, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `library-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function App(): React.JSX.Element {
  // Applied before the first paint rather than in an effect, so the page never
  // flashes the wrong theme on load.
  applyTheme(useSettings.getState().settings.theme);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: PERSIST_MAX_AGE }}
    >
      <QueryClientProvider client={queryClient}>
        <Shell />
      </QueryClientProvider>
    </PersistQueryClientProvider>
  );
}
