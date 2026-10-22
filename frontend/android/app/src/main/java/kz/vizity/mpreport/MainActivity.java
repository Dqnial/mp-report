package kz.vizity.mpreport;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SharedFilePlugin.class);
        super.onCreate(savedInstanceState);
        // приложение запустили через «Поделиться»
        SharedFilePlugin.receive(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // приложение уже было открыто (launchMode singleTask)
        SharedFilePlugin.receive(this, intent);
    }
}
