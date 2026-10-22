package kz.vizity.mpreport;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.core.content.IntentCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Файл, присланный в приложение через «Поделиться» (шаблон отчёта из WhatsApp).
 *
 * В PWA это делает share_target манифеста, но в APK Chrome не участвует —
 * Android отдаёт файл приложению Intent'ом ACTION_SEND. Здесь мы его читаем и
 * держим до тех пор, пока JS не заберёт (takePending): страница могла ещё не
 * загрузиться. Если приложение уже открыто — шлём событие «sharedFile», по нему
 * JS тоже вызывает takePending.
 */
@CapacitorPlugin(name = "SharedFile")
public class SharedFilePlugin extends Plugin {

    /** шаблон — десятки КБ; больше этого не принимаем (защита от случайного видео) */
    private static final int MAX_BYTES = 20 * 1024 * 1024;

    private static JSObject pending;
    private static SharedFilePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Вызывается из MainActivity при запуске и при каждом новом Intent. */
    static void receive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        Uri uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        if (uri == null) return;
        try {
            JSObject file = new JSObject();
            file.put("name", displayName(context, uri));
            file.put("type", intent.getType() != null ? intent.getType() : "");
            file.put("base64", readBase64(context, uri));
            pending = file;
        } catch (Exception e) {
            JSObject error = new JSObject();
            error.put("error", "Не удалось прочитать файл: " + e.getMessage());
            pending = error;
        }
        if (instance != null) instance.notifyListeners("sharedFile", new JSObject());
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject result = new JSObject();
        result.put("file", pending);
        pending = null;
        call.resolve(result);
    }

    private static String displayName(Context context, Uri uri) {
        try (Cursor c = context.getContentResolver()
                .query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "file.xlsx";
    }

    private static String readBase64(Context context, Uri uri) throws Exception {
        try (InputStream in = context.getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IllegalStateException("пустой поток");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BYTES) throw new IllegalStateException("файл слишком большой");
            }
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        }
    }
}
