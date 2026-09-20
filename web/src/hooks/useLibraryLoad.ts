/**
 * Loading the library once per session, and reporting what it cost.
 *
 * In local mode a load is a read from IndexedDB. In SIMKL mode it is five list
 * requests plus a reconcile, and occasionally some episode lists on top - see
 * `library/reconcile.ts`. The report says which, because a load that takes ten
 * seconds should be able to explain itself rather than just looking broken.
 *
 * A SIMKL failure is not fatal. The mirror was read first, so what stays on
 * screen is the library as of last time rather than a blank page, and the error
 * is surfaced alongside it instead of replacing it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryBackend, LoadReport } from "../library/backend";
import { useLibrary } from "../library/store";

export type LibraryLoadState = {
  loading: boolean;
  /** Null until the first load finishes. */
  report: LoadReport | null;
  /** Set when the source could not be reached; the mirror is still usable. */
  error: Error | null;
  reload: () => void;
};

export function useLibraryLoad(backend: LibraryBackend): LibraryLoadState {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<LoadReport | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const hydrated = useLibrary((s) => s.hydrated);

  // Identifies the run in flight, so a load left over from a previous mode
  // cannot land after the user has switched and overwrite the newer result.
  const runId = useRef(0);

  const run = useCallback(() => {
    const id = ++runId.current;
    setLoading(true);
    setError(null);

    void backend
      .load()
      .then((result) => {
        if (runId.current !== id) return;
        setReport(result.report);
      })
      .catch((cause: unknown) => {
        if (runId.current !== id) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (runId.current === id) setLoading(false);
      });
  }, [backend]);

  useEffect(run, [run]);

  return { loading: loading && !hydrated, report, error, reload: run };
}
