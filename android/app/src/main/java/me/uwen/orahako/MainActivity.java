package me.uwen.orahako;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;
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
        EdgeToEdge.enable(this);
    }
}
