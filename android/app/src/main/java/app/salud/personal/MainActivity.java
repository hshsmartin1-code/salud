package app.salud.personal;

import android.os.Bundle;
import app.salud.personal.healthconnect.HealthConnectPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin (no npm package): Health Connect, read-only.
        registerPlugin(HealthConnectPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
