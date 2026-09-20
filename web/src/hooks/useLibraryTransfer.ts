/**
 * Getting a library in and out.
 *
 * Three ways, for three different situations:
 *
 *  - export to a file, which works regardless of tokens and is the thing to do
 *    before anything else here
 *  - import a file, which is how yesterday's download becomes today's library
 *  - import everything from SIMKL, which is the switch to independence
 *
 * The SIMKL import is the same `reconcile` the mirror already runs on every load,
 * with one difference: it fetches an episode list for EVERY show that needs one
 * rather than stopping at the load-time cap. That is what makes it the deliberate
 * version of the thing a load does opportunistically - it is slow on purpose, and
 * reports progress so it does not look stuck.
 */

import { useCallback, useState } from "react";
import type { SimklClient } from "../api/simkl";
import { applyReconcile, episodeFetchList, planReconcile } from "../library/reconcile";
import { parseLibraryFile } from "../library/importFile";
import { useLibrary } from "../library/store";
import type { Library } from "../library/schema";

export type TransferProgress = {
  /** Null when nothing is running. */
  phase: "lists" | "episodes" | "writing" | null;
  done: number;
  total: number;
  message: string | null;
  error: string | null;
};

const IDLE: TransferProgress = { phase: null, done: 0, total: 0, message: null, error: null };

export type LibraryTransfer = {
  progress: TransferProgress;
  exportToFile: (library: Library) => void;
  importFromFile: (file: File) => Promise<void>;
  importFromSimkl: (simkl: SimklClient) => Promise<void>;
  dismiss: () => void;
};

export function useLibraryTransfer(): LibraryTransfer {
  const [progress, setProgress] = useState<TransferProgress>(IDLE);
  const replaceAll = useLibrary((s) => s.replaceAll);

  const exportToFile = useCallback((library: Library) => {
    const blob = new Blob([JSON.stringify(library, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `library-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);

    const shows = Object.keys(library.shows).length;
    setProgress({ ...IDLE, message: `Downloaded ${shows} shows.` });
  }, []);

  const importFromFile = useCallback(
    async (file: File) => {
      setProgress({ phase: "writing", done: 0, total: 1, message: null, error: null });
      const result = parseLibraryFile(await file.text());

      if (!result.ok) {
        setProgress({ ...IDLE, error: result.error });
        return;
      }

      await replaceAll(result.library);
      setProgress({
        ...IDLE,
        message: [
          `Restored ${result.shows} shows and ${result.watchedEpisodes} watched episodes.`,
          ...result.warnings,
        ].join(" "),
      });
    },
    [replaceAll],
  );

  const importFromSimkl = useCallback(
    async (simkl: SimklClient) => {
      setProgress({ phase: "lists", done: 0, total: 5, message: null, error: null });

      try {
        const lists = await simkl.getAllLists();

        // Planned against an EMPTY library on purpose: this is a full import, so
        // every show's history is rebuilt from SIMKL rather than trusted from a
        // mirror that may be behind.
        const plan = planReconcile({ version: 1, syncedAt: null, shows: {} }, lists);
        const wanted = episodeFetchList(plan);

        setProgress({
          phase: "episodes",
          done: 0,
          total: wanted.length,
          message: null,
          error: null,
        });

        const episodes: Record<number, Awaited<ReturnType<SimklClient["getEpisodes"]>>> = {};
        for (const [index, simklId] of wanted.entries()) {
          try {
            episodes[simklId] = await simkl.getEpisodes(simklId);
          } catch {
            // One unavailable list costs that show its episode-level history,
            // not the whole import.
            episodes[simklId] = null;
          }
          setProgress((p) => ({ ...p, done: index + 1 }));
        }

        setProgress((p) => ({ ...p, phase: "writing" }));
        const { library, counts } = applyReconcile(
          { version: 1, syncedAt: null, shows: {} },
          plan,
          episodes,
        );
        await replaceAll(library);

        const shows = Object.keys(library.shows).length;
        setProgress({
          ...IDLE,
          message:
            `Imported ${shows} shows. ${counts["from-seasons"]} came with per-episode history` +
            ` from SIMKL; ${counts["needs-episodes"]} were rebuilt from its watched counts, which` +
            ` SIMKL does not break down for completed or dropped shows.`,
        });
      } catch (cause) {
        setProgress({
          ...IDLE,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [replaceAll],
  );

  const dismiss = useCallback(() => setProgress(IDLE), []);

  return { progress, exportToFile, importFromFile, importFromSimkl, dismiss };
}
