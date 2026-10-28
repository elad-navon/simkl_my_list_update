package com.eladnavon.watchlist;

import android.content.Context;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Airing Next list the widget shows, from the account's meta "airingNext" document (written by
 * the computer, tools/emby-bridge/airing-next.js): each show with its next few episodes. Which one
 * is next is worked out here, as time passes, with the site's rules (LibraryCore.isAired and
 * nextAiringEpisodeFromList in app.js) - so the list stays right for a while without a new document.
 */
final class AiringData {

    static final int DATE_ONLY_HOUR = 10; // LibraryCore.DATE_ONLY_HOUR
    private static final int DEFAULT_MINUTES = 30;

    static final class Episode {
        int season;
        int episode;
        boolean hasTime;
        long start; // the exact air time, or the day's local midnight for a date-only episode
        String day; // "YYYY-MM-DD", local
        int runtime;
        String title;
        String badge;

        long end() {
            return start + (long) (runtime > 0 ? runtime : DEFAULT_MINUTES) * 60000L;
        }

        /** When it leaves Airing Next: the end of its broadcast, or 10:00 that day for a date only. */
        long airedAt() {
            return hasTime ? end() : start + DATE_ONLY_HOUR * 3600000L;
        }

        String label() {
            return String.format(Locale.US, "S%02dE%02d", season, episode);
        }
    }

    static final class Show {
        String key;
        String title;
        String art;
        boolean plan;
        final List<Episode> episodes = new ArrayList<>();
    }

    static final class Row {
        final Show show;
        final Episode episode;
        final boolean live;

        Row(Show show, Episode episode, boolean live) {
            this.show = show;
            this.episode = episode;
            this.live = live;
        }
    }

    private AiringData() {}

    /** The document's list; throws on anything that isn't one, so a bad download never replaces a good list. */
    static List<Show> parse(String json) throws JSONException {
        JSONObject root = new JSONObject(json);
        if (root.optInt("v") != 1) throw new JSONException("Unknown Airing Next version");
        JSONArray shows = root.getJSONArray("shows");
        List<Show> out = new ArrayList<>();
        for (int i = 0; i < shows.length(); i++) {
            JSONObject s = shows.optJSONObject(i);
            if (s == null) continue;
            Show show = new Show();
            show.key = s.optString("key", "");
            show.title = s.optString("title", "Unknown");
            show.art = s.isNull("art") ? null : s.optString("art", null);
            show.plan = s.optBoolean("plan", false);
            JSONArray eps = s.optJSONArray("eps");
            for (int j = 0; eps != null && j < eps.length(); j++) {
                JSONObject e = eps.optJSONObject(j);
                Episode ep = e == null ? null : episode(e);
                if (ep != null) show.episodes.add(ep);
            }
            if (!show.episodes.isEmpty()) out.add(show);
        }
        return out;
    }

    private static Episode episode(JSONObject e) {
        String date = e.optString("date", "");
        Episode ep = new Episode();
        ep.season = e.optInt("s", -1);
        ep.episode = e.optInt("e", -1);
        if (ep.season < 0 || ep.episode < 0) return null;
        ep.runtime = e.optInt("runtime", 0);
        ep.title = e.isNull("title") ? null : e.optString("title", null);
        ep.badge = e.isNull("badge") ? null : e.optString("badge", null);
        try {
            if (date.length() > 10) {
                ep.hasTime = true;
                ep.start = parseIso(date);
                ep.day = localDay(ep.start);
            } else if (date.length() == 10) {
                ep.start = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(date).getTime();
                ep.day = date;
            } else {
                return null;
            }
        } catch (ParseException ex) {
            return null;
        }
        return ep;
    }

    // "2026-11-03T19:30:00+00:00" (TVMaze), maybe with fractions of a second or a "Z".
    private static long parseIso(String s) throws ParseException {
        String clean = s.replaceFirst("\\.\\d+", "");
        return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).parse(clean).getTime();
    }

    private static String localDay(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(ms);
    }

    /**
     * Each show's next episode at `now`, in the site's Airing Next order: by local day; within a day,
     * exact times first by time, then date-only ones. On the air now counts (marked live); a Plan to
     * Watch show only while its next episode is the series premiere.
     */
    static List<Row> rows(List<Show> shows, long now) {
        List<Row> out = new ArrayList<>();
        for (Show show : shows) {
            Episode next = null;
            boolean live = false;
            for (Episode ep : show.episodes) {
                if (now >= ep.airedAt()) continue;
                boolean onAir = ep.hasTime && ep.start <= now;
                if (next == null || (onAir && !live) || (onAir == live && ep.start < next.start)) {
                    next = ep;
                    live = onAir;
                }
            }
            if (next == null) continue;
            if (show.plan && !(next.season == 1 && next.episode == 1)) continue;
            out.add(new Row(show, next, live));
        }
        Collections.sort(out, (a, b) -> {
            int byDay = a.episode.day.compareTo(b.episode.day);
            if (byDay != 0) return byDay;
            if (a.episode.hasTime != b.episode.hasTime) return a.episode.hasTime ? -1 : 1;
            return Long.compare(a.episode.start, b.episode.start);
        });
        return out;
    }

    /** The next moment a label or the list changes: an episode starting, ending, or a new day. */
    static long nextChange(List<Show> shows, long now) {
        Calendar midnight = Calendar.getInstance();
        midnight.setTimeInMillis(now);
        midnight.set(Calendar.HOUR_OF_DAY, 0);
        midnight.set(Calendar.MINUTE, 0);
        midnight.set(Calendar.SECOND, 0);
        midnight.set(Calendar.MILLISECOND, 0);
        midnight.add(Calendar.DAY_OF_MONTH, 1);
        long next = midnight.getTimeInMillis();
        for (Show show : shows) {
            for (Episode ep : show.episodes) {
                if (ep.hasTime && ep.start > now) next = Math.min(next, ep.start);
                if (ep.airedAt() > now) next = Math.min(next, ep.airedAt());
            }
        }
        return next;
    }

    /** "Today 21:00", "Tomorrow 03:00", "Thu 21:00", "Nov 12 21:00"; a date only: "Today", "Thu, Nov 5", "Nov 12". */
    static String dateLabel(Context context, Row row, long now) {
        if (row.live) return "On air now";
        Episode ep = row.episode;
        Calendar target = Calendar.getInstance();
        target.setTimeInMillis(ep.start);
        int days = daysBetween(now, ep.start);
        boolean sameYear = target.get(Calendar.YEAR) == yearOf(now);
        String day;
        if (days == 0) day = "Today";
        else if (days == 1) day = "Tomorrow";
        else if (days > 1 && days < 7) day = format(ep.start, ep.hasTime ? "EEE" : "EEE, MMM d");
        else day = format(ep.start, sameYear ? "MMM d" : "MMM d, yyyy");
        if (!ep.hasTime) return day;
        boolean h24 = android.text.format.DateFormat.is24HourFormat(context);
        return day + " " + format(ep.start, h24 ? "HH:mm" : "h:mm a");
    }

    private static String format(long ms, String pattern) {
        return new SimpleDateFormat(pattern, Locale.US).format(ms);
    }

    private static int yearOf(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        return c.get(Calendar.YEAR);
    }

    private static int daysBetween(long from, long to) {
        return (int) Math.round((startOfDay(to) - startOfDay(from)) / 86400000.0);
    }

    private static long startOfDay(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }
}
