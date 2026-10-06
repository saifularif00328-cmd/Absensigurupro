package id.sch.ujianaman;

import android.os.Build;
import android.webkit.JavascriptInterface;

/**
 * Jembatan JavaScript -> aplikasi. Diekspos ke halaman sebagai window.UjianAman.
 * Hanya halaman dari origin server sekolah yang bisa dimuat (navigasi lain diblokir MainActivity).
 */
final class NativeBridge {
    static final String VERSION = "1.0.0";
    private final MainActivity activity;

    NativeBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean isAvailable() {
        return true;
    }

    @JavascriptInterface
    public String info() {
        return "{\"app\":\"ujian-aman\",\"version\":\"" + VERSION + "\",\"sdk\":" + Build.VERSION.SDK_INT + "}";
    }

    /** Dipanggil web saat siswa mulai mengerjakan: sematkan layar, blokir tangkapan layar. */
    @JavascriptInterface
    public void enterExam() {
        activity.runOnUiThread(activity::onEnterExam);
    }

    /** Dipanggil web saat ujian selesai/dikunci: lepaskan penyematan. */
    @JavascriptInterface
    public void exitExam() {
        activity.runOnUiThread(activity::onExitExam);
    }

    /** Minta lokasi tunggal; hasil dikirim ke window.__ujianAmanLocation(id, json). */
    @JavascriptInterface
    public void requestLocation(String id) {
        if (!LocationJson.isSafeId(id)) return;
        activity.runOnUiThread(() -> activity.onRequestLocation(id));
    }
}
