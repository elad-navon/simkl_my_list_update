package com.eladnavon.watchlist;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The WebView scales all text by the phone's font size setting, which would push fixed-size
        // parts of the layout out of their boxes. The app is drawn at 100%, as on the website;
        // the rest of the phone keeps its setting.
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
