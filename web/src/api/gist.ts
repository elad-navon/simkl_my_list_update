/**
 * The backup: one private GitHub Gist holding one file.
 *
 * A Gist rather than a repo or a hosted service, for the reason the plan gives:
 * it keeps full version history, so "the computer died" and "I ruined my data
 * three days ago" are both covered by the same thing, and neither needs a server
 * of mine to exist. Reading it on startup makes it sync between the phone and the
 * desktop as a side effect.
 *
 * The token is fine-grained with only the `gist` scope, so the worst a leaked one
 * can do is read and write gists - no repository access at all. That is the same
 * order of risk as the SIMKL token already in this browser, and it is why this
 * uses a Gist rather than committing to a repo.
 *
 * GitHub truncates large files in the gist API response and hands back a
 * `raw_url` instead. That is not a rare case to defend against later: the export
 * of this library is 1.3MB, well past the point where it happens, so the raw
 * fetch is the normal path rather than the fallback.
 */

import { getJson, HttpError, NetworkError } from "./http";

const API = "https://api.github.com";
const SERVICE = "GitHub";

/** The one file in the gist. Named so it reads for what it is when opened. */
export const LIBRARY_FILENAME = "library.json";

const HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

/**
 * A token GitHub rejected.
 *
 * Its own type because the recovery is specific and nothing else will fix it:
 * the token is wrong, expired, or lacks the `gist` scope.
 */
export class GistAuthError extends Error {
  constructor(message = "GitHub rejected the token. Check it has the gist scope and has not expired.") {
    super(message);
    this.name = "GistAuthError";
  }
}

type GistFile = {
  filename?: string;
  content?: string;
  /** Present, and `content` absent or partial, once the file is large. */
  truncated?: boolean;
  raw_url?: string;
};

type GistResponse = {
  id?: string;
  html_url?: string;
  updated_at?: string;
  files?: Record<string, GistFile | null>;
};

export type GistSnapshot = {
  gistId: string;
  /** The file's text, whatever its size. */
  content: string;
  updatedAt: string | null;
};

export type GistClient = {
  /** Creates the private gist and returns its id. */
  create: (content: string) => Promise<{ gistId: string; htmlUrl: string | null }>;
  read: (gistId: string) => Promise<GistSnapshot | null>;
  update: (gistId: string, content: string) => Promise<{ updatedAt: string | null }>;
};

export function createGistClient(options: {
  token: string;
  fetchImpl?: typeof fetch | undefined;
}): GistClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  const send = async (path: string, method: "POST" | "PATCH", body: unknown): Promise<GistResponse> => {
    let response: Response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        method,
        headers: { ...HEADERS(options.token), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new NetworkError(SERVICE, cause);
    }

    if (response.status === 401 || response.status === 403) throw new GistAuthError();
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HttpError(SERVICE, response.status, path, text);
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as GistResponse) : {};
  };

  /**
   * Reads the file's text, following `raw_url` when GitHub truncated it.
   *
   * The raw fetch is deliberately unauthenticated - `raw_url` carries its own
   * access in the path, and sending the token to a different host than the one it
   * was issued for is not something to do casually.
   */
  const readFile = async (file: GistFile): Promise<string | null> => {
    if (file.content !== undefined && !file.truncated) return file.content;
    if (!file.raw_url) return file.content ?? null;

    try {
      const response = await fetchImpl(file.raw_url);
      if (!response.ok) return file.content ?? null;
      return await response.text();
    } catch (cause) {
      throw new NetworkError(SERVICE, cause);
    }
  };

  return {
    async create(content) {
      const created = await send("/gists", "POST", {
        description: "TV watch list - library backup",
        // Private, which on gists means unlisted: only someone with the URL can
        // see it. Worth being plain about, since "secret" is GitHub's own word
        // for it and it does not mean encrypted.
        public: false,
        files: { [LIBRARY_FILENAME]: { content } },
      });

      if (!created.id) throw new Error("GitHub created the gist but returned no id.");
      return { gistId: created.id, htmlUrl: created.html_url ?? null };
    },

    async read(gistId) {
      let gist: GistResponse | null;
      try {
        gist = await getJson<GistResponse>(`${API}/gists/${gistId}`, {
          service: SERVICE,
          headers: HEADERS(options.token),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
      } catch (cause) {
        if (cause instanceof HttpError && (cause.status === 401 || cause.status === 403)) {
          throw new GistAuthError();
        }
        throw cause;
      }

      // A 404 here means the gist is gone or the token cannot see it. Null rather
      // than an error: the caller's answer is to create a new one, which is the
      // same answer as never having had one.
      if (!gist) return null;

      const file = gist.files?.[LIBRARY_FILENAME];
      if (!file) return null;

      const content = await readFile(file);
      if (content === null) return null;

      return { gistId, content, updatedAt: gist.updated_at ?? null };
    },

    async update(gistId, content) {
      const updated = await send(`/gists/${gistId}`, "PATCH", {
        files: { [LIBRARY_FILENAME]: { content } },
      });
      return { updatedAt: updated.updated_at ?? null };
    },
  };
}
