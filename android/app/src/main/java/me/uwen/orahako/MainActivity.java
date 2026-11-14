package me.uwen.orahako;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;
import java.net.CookieHandler;
import me.uwen.orahako.widget.WidgetBridgePlugin;
import me.uwen.orahako.notify.OrahakoNotifyPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(WebViewCompatPlugin.class);
        registerPlugin(OrahakoFilePlugin.class);
        registerPlugin(OrahakoNotifyPlugin.class);
        super.onCreate(savedInstanceState);
        // CapacitorCookies installs a process-wide handler during bridge startup.
        // HttpURLConnection must use only the explicit Cookie header from the JS jar.
        CookieHandler.setDefault(null);
        EdgeToEdge.enable(this);
    }
}
