package me.uwen.orahako;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;
import java.net.CookieHandler;
import me.uwen.orahako.nativebridge.OrahakoNativePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The native composition and its capability factories are selected at
        // build time (assets/native-companion.json).
        registerPlugin(OrahakoNativePlugin.class);
        super.onCreate(savedInstanceState);
        // CapacitorCookies installs a process-wide handler during bridge startup.
        // HttpURLConnection must use only the explicit Cookie header from the JS jar.
        CookieHandler.setDefault(null);
        EdgeToEdge.enable(this);
        // Replace SystemBars' late viewport-fit probe so the first frame already
        // has its final viewport size.
        WebViewInsets.install(getBridge());
    }
}
