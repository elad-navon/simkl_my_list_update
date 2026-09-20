/**
 * Clearing the SIMKL token when SIMKL says it is dead.
 *
 * `api/simkl.ts` deliberately does not touch storage - the old `simklGet` deleted
 * the token itself on a 401 (app.js:240), which welded the request layer to the
 * storage layer and made it untestable. This is the other half of that decision:
 * one place that owns the token and reacts to the one error that invalidates it.
 *
 * The MODE is deliberately left alone. Clearing the token flips `canUseSimkl` to
 * false, which is what makes `useBackend` fall through to the local mirror and
 * the header say "selected but not authorized". Flipping the setting instead
 * would look like the user had chosen to go local, and the next thing they did
 * would be editing a list SIMKL knows nothing about.
 */

import { useCallback } from "react";
import { SimklAuthError } from "../api/simkl";
import { useSettings } from "../settings/store";

export type SimklAuthGuard = {
  /**
   * Runs `work`, and on a SIMKL 401 clears the token before rethrowing.
   *
   * Rethrows rather than swallowing: the caller still has a failed action to
   * report. What this guarantees is that by the time it surfaces, the app has
   * already stopped believing it is authorized.
   */
  guard: <T>(work: () => Promise<T>) => Promise<T>;
};

export function useSimklAuthGuard(): SimklAuthGuard {
  const update = useSettings((s) => s.update);

  const guard = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (cause) {
        if (cause instanceof SimklAuthError) update({ simklToken: "" });
        throw cause;
      }
    },
    [update],
  );

  return { guard };
}
