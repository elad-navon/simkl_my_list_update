package com.eladnavon.watchlist;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * What the widget keeps on the phone: the last good Airing Next document, how the last sync went,
 * each widget's page, and the shows' pictures (files under the app's own storage, downloaded once).
 */
final class AiringStore {

    private static final String TAG = "AiringWidget";
    private static final String PREFS = "airing_widget";
    private static final String ART_DIR = "airing-art";
    private static final int ART_MAX_WIDTH = 400;
    private static final int ART_MAX_BYTES = 3 * 1024 * 1024;

    static final int STATE_OK = 0;
    static final int STATE_NOT_SIGNED_IN = 1;
    static final int STATE_NOTHING_YET = 2; // signed in, but the computer hasn't written the list yet

    private final Context context;
    private final SharedPreferences prefs;

    AiringStore(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---- The list ------------------------------------------------------------------------------

    /** The last good list, or null if there's none (or it can't be read). */
    List<AiringData.Show> shows() {
        String json = prefs.getString("json", null);
        if (json == null) return null;
        try {
            return AiringData.parse(json);
        } catch (Exception e) {
            return null;
        }
    }

    void saveList(String json) {
        prefs.edit()
            .putString("json", json)
            .putInt("state", STATE_OK)
            .putLong("okAt", System.currentTimeMillis())
            .putBoolean("failing", false)
            .apply();
    }

    void setState(int state) {
        prefs.edit().putInt("state", state).putBoolean("failing", false).apply();
    }

    int state() {
        return prefs.getInt("state", STATE_NOTHING_YET);
    }

    void markFailure(String why) {
        prefs.edit().putBoolean("failing", true).putString("error", why).apply();
    }

    /** The last sync failed and the list on show is more than three hours old. */
    boolean stale() {
        return prefs.getBoolean("failing", false)
            && System.currentTimeMillis() - prefs.getLong("okAt", 0) > 3 * 3600000L;
    }

    // ---- Pages, per widget ---------------------------------------------------------------------

    int page(int widgetId) {
        return prefs.getInt("page_" + widgetId, 0);
    }

    void setPage(int widgetId, int page) {
        prefs.edit().putInt("page_" + widgetId, page).apply();
    }

    void forget(int widgetId) {
        prefs.edit().remove("page_" + widgetId).apply();
    }

    // ---- Pictures ------------------------------------------------------------------------------

    private File artDir() {
        File dir = new File(context.getFilesDir(), ART_DIR);
        if (!dir.isDirectory()) dir.mkdirs();
        return dir;
    }

    private File artFile(String url) {
        return new File(artDir(), sha1(url) + ".jpg");
    }

    /** Downloads the pictures not on the phone yet and deletes those no show uses any more. */
    void syncArt(List<AiringData.Show> shows) {
        Set<String> keep = new HashSet<>();
        for (AiringData.Show show : shows) {
            if (show.art == null || !show.art.startsWith("https://")) continue;
            File file = artFile(show.art);
            keep.add(file.getName());
            if (file.exists()) continue;
            try {
                download(show.art, file);
            } catch (IOException e) {
                Log.w(TAG, "Picture for " + show.title + ": " + e.getMessage());
            }
        }
        File[] files = artDir().listFiles();
        for (File f : files == null ? new File[0] : files) {
            if (!keep.contains(f.getName())) f.delete();
        }
    }

    private void download(String url, File file) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        try {
            if (conn.getResponseCode() != 200) throw new IOException("HTTP " + conn.getResponseCode());
            byte[] bytes = readLimited(conn.getInputStream());
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0) throw new IOException("not a picture");
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = 1;
            while (bounds.outWidth / (opts.inSampleSize * 2) >= ART_MAX_WIDTH) opts.inSampleSize *= 2;
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
            if (bitmap == null) throw new IOException("not a picture");
            if (bitmap.getWidth() > ART_MAX_WIDTH) {
                int h = Math.round(bitmap.getHeight() * (ART_MAX_WIDTH / (float) bitmap.getWidth()));
                bitmap = Bitmap.createScaledBitmap(bitmap, ART_MAX_WIDTH, h, true);
            }
            File tmp = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out);
            }
            if (!tmp.renameTo(file)) throw new IOException("couldn't save");
        } finally {
            conn.disconnect();
        }
    }

    private static byte[] readLimited(InputStream in) throws IOException {
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > ART_MAX_BYTES) throw new IOException("picture too big");
            }
            return out.toByteArray();
        }
    }

    /** The show's picture cut to `width` x `height` px with rounded corners, or null if it isn't on the phone. */
    Bitmap art(String url, int width, int height, float radius) {
        if (url == null || width <= 0 || height <= 0) return null;
        File file = artFile(url);
        if (!file.exists()) return null;
        Bitmap src = BitmapFactory.decodeFile(file.getPath());
        if (src == null) return null;
        // Center-crop to the card's shape, then round the corners (a widget can't clip an image itself).
        float scale = Math.max(width / (float) src.getWidth(), height / (float) src.getHeight());
        float dx = (width - src.getWidth() * scale) / 2f, dy = (height - src.getHeight() * scale) / 2f;
        Bitmap out = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        BitmapShader shader = new BitmapShader(src, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
        android.graphics.Matrix m = new android.graphics.Matrix();
        m.setScale(scale, scale);
        m.postTranslate(dx, dy);
        shader.setLocalMatrix(m);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        paint.setShader(shader);
        new Canvas(out).drawRoundRect(new RectF(0, 0, width, height), radius, radius, paint);
        return out;
    }

    private static String sha1(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }
}
