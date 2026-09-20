/**
 * The SIMKL PIN flow. Ported from app.js:181-224.
 *
 * You are shown a code, you enter it on simkl.com, and this polls until SIMKL
 * says it was approved. There is no refresh token anywhere in the flow, which is
 * why this screen has to exist at all rather than only once: a 401 is terminal
 * and the only recovery is coming back here.
 *
 * The old version ran the poll inside `getAccessToken` and wrote the markup
 * directly into `#app`, so the loop and the page it was drawing were the same
 * function. Here the loop lives in `api/simkl.ts`, already tested against an
 * expired code and a transient failure, and this component only shows it.
 */

import { useEffect, useRef, useState } from "react";
import { pollForToken, startPinAuth, type SimklPinStart } from "../api/simkl";
import styles from "./SimklAuthDialog.module.css";

export type SimklAuthDialogProps = {
  clientId: string;
  onAuthorized: (token: string) => void;
  onClose: () => void;
};

type Phase =
  | { kind: "starting" }
  | { kind: "waiting"; start: SimklPinStart }
  | { kind: "expired" }
  | { kind: "failed"; message: string };

export function SimklAuthDialog({
  clientId,
  onAuthorized,
  onClose,
}: SimklAuthDialogProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [attempt, setAttempt] = useState(0);

  // React 19 still mounts effects twice in development, and starting two PIN
  // flows would show a code the second request has already invalidated.
  const running = useRef(0);

  useEffect(() => {
    const id = ++running.current;
    const controller = new AbortController();

    void (async () => {
      try {
        const start = await startPinAuth(clientId);
        if (running.current !== id) return;
        setPhase({ kind: "waiting", start });

        const token = await pollForToken(clientId, start, { signal: controller.signal });
        if (running.current !== id || controller.signal.aborted) return;

        if (token) onAuthorized(token);
        else setPhase({ kind: "expired" });
      } catch (cause) {
        if (running.current !== id) return;
        setPhase({
          kind: "failed",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [clientId, attempt, onAuthorized]);

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-box" role="dialog" aria-label="Authorize SIMKL">
        <h2>
          One-time authorization
          <button type="button" className="modal-close-btn" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </h2>

        {phase.kind === "starting" ? (
          <>
            <div className="spinner" />
            <p className={styles.note}>Asking SIMKL for a code…</p>
          </>
        ) : null}

        {phase.kind === "waiting" ? (
          <>
            <p>
              1. Go to{" "}
              <a href={phase.start.verificationUrl} target="_blank" rel="noreferrer">
                {phase.start.verificationUrl}
              </a>
            </p>
            <p>2. Enter this code:</p>
            <div className="pin-code">{phase.start.userCode}</div>
            <div className="spinner" />
            <p className={styles.note}>Waiting for approval&hellip;</p>
          </>
        ) : null}

        {phase.kind === "expired" ? (
          <>
            <p className={styles.note}>
              That code expired before it was approved. Codes are short-lived on purpose.
            </p>
            <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
              Get a new code
            </button>
          </>
        ) : null}

        {phase.kind === "failed" ? (
          <>
            <div className="error-box">{phase.message}</div>
            <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
