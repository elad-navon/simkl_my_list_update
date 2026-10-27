package com.eladnavon.watchlist;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The WebView scales all text by the phone's font size setting, which would push fixed-size
        // parts of the layout out of their boxes. The app is drawn at 100%, as on the website;
        // the rest of the phone keeps its setting.
        getBridge().getWebView().getSettings().setTextZoom(100);

        // Back first asks the site (window.appBackPressed, app.js) to step out of whatever is open -
        // a menu, a window, Settings; only when nothing is open does it close the app as before.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                getBridge().getWebView().evaluateJavascript(
                    "(function(){try{return !!(window.appBackPressed&&window.appBackPressed())}catch(e){return false}})()",
                    handled -> {
                        if ("true".equals(handled)) return;
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    });
            }
        });
    }
}
