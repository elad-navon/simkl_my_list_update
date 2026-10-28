package com.eladnavon.watchlist;

import android.content.Context;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Fetches the Airing Next list for the home-screen widget in the background - no WebView needed: the
 * account's meta "airingNext" document (written by the computer, tools/emby-bridge/airing-next.js),
 * read through Firestore's REST API as the user signed in on the phone (the app's native sign-in).
 * About once an hour when there's a network (Android may run it later to save battery), and when
 * the app is opened. A failed fetch keeps the last good list.
 */
public class AiringSyncWorker extends Worker {

    private static final String TAG = "AiringWidget";
    private static final String PERIODIC = "airing-sync";
    private static final String NOW = "airing-sync-now";

    public AiringSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** The hourly sync (kept if it's already scheduled). */
    static void schedule(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(AiringSyncWorker.class, 1, TimeUnit.HOURS)
            .setConstraints(online())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    /** One sync as soon as there's a network. */
    static void syncNow(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(AiringSyncWorker.class)
            .setConstraints(online())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, request);
    }

    static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC);
        WorkManager.getInstance(context).cancelUniqueWork(NOW);
    }

    private static Constraints online() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        AiringStore store = new AiringStore(context);
        try {
            FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
            if (user == null) {
                store.setState(AiringStore.STATE_NOT_SIGNED_IN);
                return Result.success();
            }
            String token = Tasks.await(user.getIdToken(false), 30, TimeUnit.SECONDS).getToken();
            String project = FirebaseApp.getInstance().getOptions().getProjectId();
            URL url = new URL("https://firestore.googleapis.com/v1/projects/" + project
                + "/databases/(default)/documents/users/" + user.getUid() + "/meta/airingNext");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            String body;
            try {
                int code = conn.getResponseCode();
                if (code == 404) {
                    if (store.shows() == null) store.setState(AiringStore.STATE_NOTHING_YET);
                    return Result.success();
                }
                if (code != 200) throw new IOException("Firestore HTTP " + code);
                body = read(conn.getInputStream());
            } finally {
                conn.disconnect();
            }
            String json = new JSONObject(body).getJSONObject("fields").getJSONObject("json").getString("stringValue");
            List<AiringData.Show> shows = AiringData.parse(json); // throws on a bad document: the old list stays
            store.saveList(json);
            store.syncArt(shows);
            return Result.success();
        } catch (Exception e) {
            Log.w(TAG, "Sync failed: " + e);
            store.markFailure(String.valueOf(e.getMessage()));
            return getRunAttemptCount() < 4 ? Result.retry() : Result.failure();
        } finally {
            AiringWidgetProvider.refreshAll(context);
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }
}
