/**
 * Adding a show. Ported from app.js:1651-1760 and the search markup it built.
 *
 * Two things are different, and both come from the library being local.
 *
 * Every result says whether it is already on your list and under what status,
 * which the old app could only answer by fetching all five SIMKL lists per query.
 * So the row offers a status change rather than a blind "add", and adding
 * something you already have can no longer look like a new addition.
 *
 * And the keyboard works. The old version tracked a highlighted row in a module
 * variable and moved a class around by hand (app.js:1683-1697); here the index is
 * state, and the highlight is announced with `aria-current` so a screen reader
 * follows the same one the mouse does.
 *
 * Deliberately NOT a listbox. That was the first shape this took, and it is
 * invalid: an `option` may not contain interactive content, and every row here
 * holds a status menu. A plain list with a current row says what is true - these
 * are results, not a single-select widget - and it also stops the menu's own
 * `<option>` elements colliding with the rows in the accessibility tree.
 */

import { useEffect, useRef, useState } from "react";
import { STATUS_OPTIONS, statusLabel, type MatchedSearchResult } from "../domain/search";
import type { ShowStatus } from "../domain/types";
import styles from "./SearchModal.module.css";

export type SearchModalProps = {
  query: string;
  onQueryChange: (query: string) => void;
  results: MatchedSearchResult[];
  searching: boolean;
  error: string | null;
  empty: boolean;
  onAdd: (result: MatchedSearchResult, status: ShowStatus) => void;
  onClose: () => void;
  /** The key currently being written, so its row can say so. */
  busyKey: string | null;
};

export function SearchModal({
  query,
  onQueryChange,
  results,
  searching,
  error,
  empty,
  onAdd,
  onClose,
  busyKey,
}: SearchModalProps): React.JSX.Element {
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A new result set invalidates the old highlight, and leaving it where it was
  // would mean Enter adding whatever happens to be in that position now.
  useEffect(() => {
    setActive(0);
  }, [results]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      const result = results[active];
      // Enter on something already on the list would otherwise silently re-add
      // it under a status you did not pick.
      if (result && !result.libraryStatus) {
        event.preventDefault();
        onAdd(result, "plantowatch");
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-box"
        role="dialog"
        aria-label="Search for a show"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2>
          Search
          <button type="button" className="modal-close-btn" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </h2>

        <input
          ref={inputRef}
          type="search"
          className={styles.input}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Title, in any language"
          aria-label="Search for a show"
          aria-controls="searchResults"
          autoComplete="off"
        />

        {error ? <div className="error-box">{error}</div> : null}

        {searching ? <p className={styles.note}>Searching…</p> : null}
        {empty && !searching ? <p className={styles.note}>No results.</p> : null}

        <ul id="searchResults" ref={listRef} className={styles.results}>
          {results.map((result, index) => {
            const key = `${result.source}:${result.ids.tmdb ?? result.ids.simkl ?? result.title}`;
            const onList = result.libraryStatus !== null;

            return (
              <li
                key={key}
                className={index === active ? styles.rowActive : styles.row}
                aria-current={index === active}
                onMouseEnter={() => setActive(index)}
              >
                {result.posterUrl ? (
                  <img className={styles.poster} src={result.posterUrl} alt="" loading="lazy" />
                ) : (
                  <div className={`${styles.poster} ${styles.posterPlaceholder}`} aria-hidden="true">
                    {(result.title[0] ?? "?").toUpperCase()}
                  </div>
                )}

                <div className={styles.info}>
                  <div className={styles.title}>{result.title}</div>
                  <div className={styles.year}>
                    {result.year}
                    {onList ? (
                      <span className={styles.onList}>
                        {" "}
                        · already {statusLabel(result.libraryStatus as ShowStatus)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <select
                  className={styles.status}
                  // Reflects what the show already is, so the control reads as
                  // "change this" rather than as an empty choice.
                  value={result.libraryStatus ?? ""}
                  disabled={busyKey === result.libraryKey && busyKey !== null}
                  aria-label={`${onList ? "Change the status of" : "Add"} ${result.title}`}
                  onChange={(e) => {
                    if (e.target.value) onAdd(result, e.target.value as ShowStatus);
                  }}
                >
                  <option value="">{onList ? "Change to…" : "Add to…"}</option>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
