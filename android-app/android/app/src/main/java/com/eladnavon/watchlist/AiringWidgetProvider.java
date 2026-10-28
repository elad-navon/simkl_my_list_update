package com.eladnavon.watchlist;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.View;
import android.widget.RemoteViews;
import java.util.Collections;
import java.util.List;

/**
 * The Airing Next home-screen widget. One row (5x1): two text cards - show, episode, when. Stretched
 * to two rows (5x2): three cards with the show's picture. The arrows page through the list without
 * opening the app; a card opens the app as its icon does. Labels ("Today 21:00", "On air now") are
 * worked out from the saved dates whenever it's drawn, and it wakes itself (inexactly) when one of
 * them is due to change. The list comes from AiringSyncWorker.
 */
public class AiringWidgetProvider extends AppWidgetProvider {

    private static final String ACTION_PAGE = "com.eladnavon.watchlist.widget.PAGE";
    private static final String ACTION_TICK = "com.eladnavon.watchlist.widget.TICK";
    private static final String EXTRA_DIR = "dir";
    private static final int LARGE_MIN_HEIGHT_DP = 110;

    private static final int ACCENT = 0xFFFBBF24;
    private static final int LIVE = 0xFFFCA5A5;
    private static final int DATE = 0xBDFFFFFF;

    private static final int[][] SMALL = {
        { R.id.card0, R.id.card0_title, R.id.card0_ep, R.id.card0_badge, R.id.card0_date },
        { R.id.card1, R.id.card1_title, R.id.card1_ep, R.id.card1_badge, R.id.card1_date },
    };
    // card, title, episode, badge, date, picture, episode title
    private static final int[][] LARGE = {
        { R.id.card0, R.id.card0_title, R.id.card0_ep, R.id.card0_badge, R.id.card0_date, R.id.card0_art, R.id.card0_etitle },
        { R.id.card1, R.id.card1_title, R.id.card1_ep, R.id.card1_badge, R.id.card1_date, R.id.card1_art, R.id.card1_etitle },
        { R.id.card2, R.id.card2_title, R.id.card2_ep, R.id.card2_badge, R.id.card2_date, R.id.card2_art, R.id.card2_etitle },
    };

    /** Redraws every Airing Next widget (after a sync, a new day, ...). */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, AiringWidgetProvider.class));
        for (int id : ids) draw(context, manager, id);
        scheduleTick(context, ids.length > 0);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        AiringSyncWorker.schedule(context);
        refreshAll(context);
    }

    @Override
    public void onEnabled(Context context) {
        AiringSyncWorker.schedule(context);
        AiringSyncWorker.syncNow(context);
    }

    @Override
    public void onDisabled(Context context) {
        AiringSyncWorker.cancel(context);
        scheduleTick(context, false);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        AiringStore store = new AiringStore(context);
        for (int id : ids) store.forget(id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        draw(context, manager, id);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (ACTION_PAGE.equals(action)) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return;
            AiringStore store = new AiringStore(context);
            store.setPage(id, Math.max(0, store.page(id) + intent.getIntExtra(EXTRA_DIR, 1))); // draw() caps the end
            draw(context, AppWidgetManager.getInstance(context), id);
            return;
        }
        if (ACTION_TICK.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action) || Intent.ACTION_LOCALE_CHANGED.equals(action)) {
            refreshAll(context);
            return;
        }
        super.onReceive(context, intent);
    }

    // ---- Drawing -------------------------------------------------------------------------------

    private static void draw(Context context, AppWidgetManager manager, int id) {
        Bundle options = manager.getAppWidgetOptions(id);
        // In portrait a widget gets its min width and max height; that's how it's laid out on most phones.
        int heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        int widthDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        boolean large = heightDp >= LARGE_MIN_HEIGHT_DP;
        RemoteViews views = new RemoteViews(context.getPackageName(), large ? R.layout.widget_airing_large : R.layout.widget_airing_small);

        AiringStore store = new AiringStore(context);
        List<AiringData.Show> shows = store.shows();
        long now = System.currentTimeMillis();
        List<AiringData.Row> rows = shows == null ? Collections.emptyList() : AiringData.rows(shows, now);
        PendingIntent open = openApp(context);
        views.setOnClickPendingIntent(R.id.root, open);

        if (rows.isEmpty()) {
            String title, sub;
            if (store.state() == AiringStore.STATE_NOT_SIGNED_IN) {
                title = "Sign in to My Watch List";
                sub = "Then Airing Next shows up here";
            } else if (shows == null) {
                title = "Open My Watch List once";
                sub = "to load Airing Next";
            } else {
                title = "Nothing airing soon";
                sub = "Shows you're watching will appear here";
            }
            views.setViewVisibility(R.id.content, View.GONE);
            views.setViewVisibility(R.id.dots, View.GONE);
            views.setViewVisibility(R.id.msg, View.VISIBLE);
            views.setTextViewText(R.id.msg_title, title);
            views.setTextViewText(R.id.msg_sub, sub);
            views.setViewVisibility(R.id.stale, store.stale() ? View.VISIBLE : View.GONE);
            manager.updateAppWidget(id, views);
            return;
        }

        int[][] slots = large ? LARGE : SMALL;
        int perPage = slots.length;
        int pages = (rows.size() + perPage - 1) / perPage;
        // The list has a start and an end: no wrapping round from the last page to the first.
        int page = Math.max(0, Math.min(store.page(id), pages - 1));
        if (page != store.page(id)) store.setPage(id, page);

        views.setViewVisibility(R.id.msg, View.GONE);
        views.setViewVisibility(R.id.content, View.VISIBLE);
        views.setViewVisibility(R.id.stale, store.stale() ? View.VISIBLE : View.GONE);

        boolean paged = pages > 1;
        // On the first page the back arrow is dimmed, on the last the forward one. They stay there and still
        // take the tap (doing nothing), so a tap at the end doesn't fall through to a card and open the app.
        views.setViewVisibility(R.id.prev, paged ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.next, paged ? View.VISIBLE : View.GONE);
        views.setInt(R.id.prev_icon, "setImageAlpha", page > 0 ? 255 : 70);
        views.setInt(R.id.next_icon, "setImageAlpha", page < pages - 1 ? 255 : 70);
        // One row: the arrows have their own strips beside the cards. Two rows: they lie over the pictures' edges.
        int side = dp(context, paged && !large ? 0 : 8);
        views.setViewPadding(R.id.cards, side, dp(context, 8), side, dp(context, 10));
        if (paged) {
            views.setOnClickPendingIntent(R.id.prev, pageIntent(context, id, -1));
            views.setOnClickPendingIntent(R.id.next, pageIntent(context, id, 1));
            views.setViewVisibility(R.id.dots, View.VISIBLE);
            views.setTextViewText(R.id.dots, dots(pages, page));
        } else {
            views.setViewVisibility(R.id.dots, View.GONE);
        }

        // A card's picture, sized to about its share of the widget.
        int cardW = Math.max(40, (widthDp - 16 - 5 * (perPage - 1)) / perPage - 10);
        int artH = Math.max(30, heightDp - 18 - 74);
        float density = context.getResources().getDisplayMetrics().density;

        for (int i = 0; i < perPage; i++) {
            int[] slot = slots[i];
            int index = page * perPage + i;
            if (index >= rows.size()) {
                // Last page: keep the empty places so the cards don't stretch; only one show at all: it takes the room.
                views.setViewVisibility(slot[0], rows.size() < perPage ? View.GONE : View.INVISIBLE);
                continue;
            }
            AiringData.Row row = rows.get(index);
            views.setViewVisibility(slot[0], View.VISIBLE);
            views.setOnClickPendingIntent(slot[0], open);
            views.setTextViewText(slot[1], row.show.title);
            views.setTextViewText(slot[2], row.episode.label());
            if (row.episode.badge != null) {
                views.setViewVisibility(slot[3], View.VISIBLE);
                views.setTextViewText(slot[3], shortBadge(row.episode.badge));
            } else {
                views.setViewVisibility(slot[3], View.GONE);
            }
            String when = AiringData.dateLabel(context, row, now);
            views.setTextViewText(slot[4], row.live ? "● " + when : when);
            views.setTextColor(slot[4], row.live ? LIVE : DATE);
            if (large) {
                Bitmap art = store.art(row.show.art, Math.round(cardW * density), Math.round(artH * density), 7 * density);
                if (art != null) views.setImageViewBitmap(slot[5], art);
                else views.setImageViewResource(slot[5], R.drawable.widget_art_placeholder);
                String etitle = row.episode.title;
                views.setViewVisibility(slot[6], etitle != null ? View.VISIBLE : View.GONE);
                if (etitle != null) views.setTextViewText(slot[6], etitle);
            }
        }
        manager.updateAppWidget(id, views);
    }

    private static String shortBadge(String badge) {
        return badge.replace("SERIES ", "").replace("SEASON ", "");
    }

    private static CharSequence dots(int pages, int page) {
        SpannableStringBuilder sb = new SpannableStringBuilder();
        for (int i = 0; i < pages && i < 12; i++) {
            int start = sb.length();
            sb.append(i == 0 ? "●" : " ●");
            sb.setSpan(new ForegroundColorSpan(i == page ? ACCENT : 0x38FFFFFF), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return sb;
    }

    private static int dp(Context context, int dp) {
        return Math.round(dp * context.getResources().getDisplayMetrics().density);
    }

    // ---- Intents -------------------------------------------------------------------------------

    /** Opens the app as its icon does. */
    private static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent pageIntent(Context context, int id, int dir) {
        Intent intent = new Intent(context, AiringWidgetProvider.class)
            .setAction(ACTION_PAGE)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            .putExtra(EXTRA_DIR, dir);
        return PendingIntent.getBroadcast(context, id * 2 + (dir > 0 ? 1 : 0), intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** An inexact wake-up when the next label changes (an episode starts or ends, or a new day). */
    private static void scheduleTick(Context context, boolean on) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, AiringWidgetProvider.class).setAction(ACTION_TICK);
        PendingIntent tick = PendingIntent.getBroadcast(context, -1, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        if (alarms == null) return;
        if (!on) {
            alarms.cancel(tick);
            return;
        }
        List<AiringData.Show> shows = new AiringStore(context).shows();
        long now = System.currentTimeMillis();
        long at = AiringData.nextChange(shows == null ? Collections.emptyList() : shows, now);
        alarms.set(AlarmManager.RTC, Math.max(at, now + 60000L) + 5000L, tick);
    }
}
