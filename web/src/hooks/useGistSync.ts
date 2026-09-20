/**
 * The Gist backup, wired to the library.
 *
 * Pulls once when a token and a gist exist, then pushes whenever the library
 * settles. Both halves are deliberately quiet about failure: a backup that is not
 * working is a thing to tell the user about, not a thing to stop them using the
 * app over, because the library in front of them is fine either way.
 *
 * The one case handled loudly is an unreadable backup. Pushing over it would
 * destroy the only copy of whatever is in there, so pushes stop until it is
 * resolved rather than quietly overwriting.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createGistClient, GistAuthError } from "../api/gist";
import { createDebouncedPush, pullFromGist, pushToGist } from "../library/sync";
import { useLibrary } from "../library/store";
import { useSettings } from "../settings/store";
import type { Library } from "../library/schema";

export type SyncStatus = {
  state: "off" | "pulling" | "pushing" | "idle" | "error" | "blocked";
  /** What happened, for the settings screen and the header line. */
  message: string | null;
  lastSyncedAt: string | null;
};

export function useGistSync(): SyncStatus & { flush: () => Promise<void> } {
  const settings = useSettings((s) => s.settings);
  const updateSettings = useSettings((s) => s.update);
  const library = useLibrary((s) => s.library);
  const hydrated = useLibrary((s) => s.hydrated);
  const replaceAll = useLibrary((s) => s.replaceAll);

  const [status, setStatus] = useState<SyncStatus>({
    state: settings.gistToken ? "idle" : "off",
    message: null,
    lastSyncedAt: null,
  });

  /**
   * Set when the remote copy cannot be parsed. While true, nothing is pushed:
   * the whole point is to not overwrite a backup nobody has read successfully.
   */
  const blocked = useRef(false);
  const pulled = useRef(false);

  const token = settings.gistToken;
  const gistId = settings.gistId;

  // --- push ----------------------------------------------------------------

  const pusher = useRef<ReturnType<typeof createDebouncedPush> | null>(null);

  const doPush = useCallback(
    async (snapshot: Library) => {
      if (!token || blocked.current) return;
      setStatus((s) => ({ ...s, state: "pushing", message: null }));

      try {
        const result = await pushToGist(createGistClient({ token }), gistId || null, snapshot);
        if (result.created) updateSettings({ gistId: result.gistId });
        setStatus({ state: "idle", message: null, lastSyncedAt: result.updatedAt });
      } catch (cause) {
        setStatus({
          state: "error",
          message:
            cause instanceof GistAuthError
              ? cause.message
              : `Backup failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          lastSyncedAt: null,
        });
      }
    },
    [token, gistId, updateSettings],
  );

  if (pusher.current === null) pusher.current = createDebouncedPush(doPush);
  // The closure has to be refreshed when the token or gist id changes, or a push
  // would go out with the previous credentials.
  useEffect(() => {
    pusher.current = createDebouncedPush(doPush);
  }, [doPush]);

  // --- pull ----------------------------------------------------------------

  useEffect(() => {
    if (!token || !gistId || !hydrated || pulled.current) return;
    pulled.current = true;

    void (async () => {
      setStatus((s) => ({ ...s, state: "pulling", message: null }));
      try {
        const outcome = await pullFromGist(
          createGistClient({ token }),
          gistId,
          useLibrary.getState().library,
        );

        if (outcome.kind === "unreadable") {
          blocked.current = true;
          setStatus({
            state: "blocked",
            message:
              `The backup could not be read (${outcome.reason}), so nothing is being written to it. ` +
              `Open the gist and check it, or clear the gist ID in settings to start a new one.`,
            lastSyncedAt: null,
          });
          return;
        }

        if (outcome.kind === "absent") {
          // Nothing up there yet, so the local library becomes the first backup.
          setStatus({ state: "idle", message: "No backup found yet - creating one.", lastSyncedAt: null });
          await doPush(useLibrary.getState().library);
          return;
        }

        await replaceAll(outcome.library);
        const { added, episodesGained, keptDeleted } = outcome.stats;
        const notes = [
          added > 0 ? `${added} shows from the backup` : null,
          episodesGained > 0 ? `${episodesGained} watched episodes recovered` : null,
          keptDeleted > 0 ? `${keptDeleted} stayed deleted` : null,
        ].filter(Boolean);

        setStatus({
          state: "idle",
          message: notes.length ? `Synced: ${notes.join(", ")}.` : null,
          lastSyncedAt: outcome.library.syncedAt,
        });
      } catch (cause) {
        setStatus({
          state: "error",
          message:
            cause instanceof GistAuthError
              ? cause.message
              : `Could not read the backup: ${cause instanceof Error ? cause.message : String(cause)}`,
          lastSyncedAt: null,
        });
      }
    })();
  }, [token, gistId, hydrated, replaceAll, doPush]);

  // --- schedule a push whenever the library settles ------------------------

  useEffect(() => {
    // Nothing to back up before the first read finishes, and pushing an empty
    // library over a good backup is the one mistake that would really hurt.
    if (!token || !hydrated || !pulled.current || blocked.current) return;
    pusher.current?.schedule(library);
  }, [library, token, hydrated]);

  const flush = useCallback(async () => {
    await pusher.current?.flush();
  }, []);

  /**
   * A pending push is lost if the tab closes, so it is flushed when the page is
   * hidden - the same event the old app used to check for a new service worker
   * (app.js:3613-3626).
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [flush]);

  return { ...status, flush };
}
