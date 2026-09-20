/**
 * Choosing the backend from settings, and reporting honestly when it cannot run.
 *
 * SIMKL mode being selected is not the same as SIMKL mode being usable. A 401
 * clears the token without changing the setting, because "still on SIMKL, needs
 * authorizing again" is a real state that must not be dressed up as having
 * switched to local - that would silently show a different list and invite the
 * user to start editing it.
 *
 * So this hook returns the backend that can actually run plus, when they differ,
 * why. The local library is always usable, which is the point of keeping it
 * mirrored: a SIMKL outage or an expired token degrades to your own data rather
 * than to a blank page.
 */

import { useMemo } from "react";
import { guardBackend } from "../library/guardBackend";
import { useSimklAuthGuard } from "./useSimklAuthGuard";
import { createClients, type ApiClients } from "../api/clients";
import { createLocalBackend } from "../library/localBackend";
import { createSimklBackend } from "../library/simklBackend";
import { useLibrary, type LibraryState } from "../library/store";
import type { LibraryBackend } from "../library/backend";
import { canUseSimkl } from "../settings/schema";
import { useSettings } from "../settings/store";

export type BackendUnavailableReason =
  /** SIMKL is selected but the client id or token is missing. */
  | "simkl-not-authorized";

export type BackendSelection = {
  backend: LibraryBackend;
  clients: ApiClients;
  /** What settings asked for, which can differ from what is running. */
  requestedMode: "simkl" | "local";
  /** Null when the requested mode is the one in use. */
  unavailable: BackendUnavailableReason | null;
};

export function useBackend(): BackendSelection {
  const settings = useSettings((s) => s.settings);
  const { guard } = useSimklAuthGuard();

  return useMemo(() => {
    const simklUsable = canUseSimkl(settings);
    const credentials = simklUsable
      ? { clientId: settings.simklClientId, token: settings.simklToken }
      : null;
    const clients = createClients(settings, credentials);

    // A stable getter rather than a snapshot: the backends read the store at the
    // moment they act, so a mutation never writes against a library that has
    // moved on since the component rendered.
    const store = (): LibraryState => useLibrary.getState();
    const local = createLocalBackend(store);

    const wantsSimkl = settings.backendMode === "simkl";
    if (wantsSimkl && clients.simkl) {
      return {
        // Wrapped so that a 401 from any call - a load, a status change, a
        // watched episode - clears the token in one place rather than in each.
        backend: guardBackend(
          createSimklBackend({ simkl: clients.simkl, mirror: local, store }),
          guard,
        ),
        clients,
        requestedMode: "simkl" as const,
        unavailable: null,
      };
    }

    return {
      backend: local,
      clients,
      requestedMode: settings.backendMode,
      unavailable: wantsSimkl ? ("simkl-not-authorized" as const) : null,
    };
  }, [settings, guard]);
}
