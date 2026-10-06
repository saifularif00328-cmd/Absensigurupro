package id.sch.ujianaman;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * Cangkang aplikasi: memuat web Absensi Guru Pro dalam WebView yang dikunci ke satu server,
 * menyediakan jembatan native (mode ujian kiosk, lokasi dengan deteksi lokasi palsu),
 * dan melaporkan peristiwa pelanggaran (keluar aplikasi, split-screen, penyematan dilepas) ke halaman web.
 */
public class MainActivity extends Activity {
    private static final int REQ_CAMERA = 11;
    private static final int REQ_LOCATION_WEB = 12;
    private static final int REQ_LOCATION_BRIDGE = 13;
    private static final int REQ_FILE = 14;
    private static final long MONITOR_MS = 2000;
    private static final long LOCK_GRACE_MS = 5000;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final KioskController kiosk = new KioskController();
    private Prefs prefs;
    private String origin;
    private WebView web;
    private TextView errorView;
    private FrameLayout root;

    private boolean examActive;
    private long examSince;
    private boolean pendingLeave;
    private boolean permissionFlow;
    private boolean lockLostReported;
    private int wrongPins;
    private long pinBlockedUntil;

    private int tapCount;
    private long firstTap;

    private PermissionRequest pendingWebPermission;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;
    private String pendingLocationId;
    private ValueCallback<Uri[]> fileCallback;

    private final Runnable monitor = new Runnable() {
        @Override
        public void run() {
            if (!examActive) return;
            boolean locked = kiosk.isLocked(MainActivity.this);
            if (!locked && System.currentTimeMillis() - examSince > LOCK_GRACE_MS) {
                if (!lockLostReported) {
                    lockLostReported = true;
                    sendEvent("kiosk_lepas");
                    Toast.makeText(MainActivity.this, "Penyematan layar terlepas. Ini dicatat sebagai pelanggaran.", Toast.LENGTH_LONG).show();
                    kiosk.enter(MainActivity.this); // minta menyematkan lagi
                }
            } else if (locked) {
                lockLostReported = false;
            }
            ui.postDelayed(this, MONITOR_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);
        origin = prefs.origin();
        if (origin == null || !prefs.hasPin()) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }
        buildUi();
        web.loadUrl(origin);
    }

    private void buildUi() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#060918"));

        web = new WebView(this);
        configureWebView();
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        errorView = new TextView(this);
        errorView.setTextColor(Color.WHITE);
        errorView.setTextSize(16);
        errorView.setGravity(Gravity.CENTER);
        errorView.setPadding(dp(32), dp(32), dp(32), dp(32));
        errorView.setBackgroundColor(Color.parseColor("#060918"));
        errorView.setVisibility(View.GONE);
        errorView.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            web.reload();
        });
        root.addView(errorView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Area tak terlihat di pojok kiri atas: ketuk 7 kali untuk menu proktor (dilindungi PIN)
        View hotspot = new View(this);
        hotspot.setOnTouchListener((v, ev) -> {
            if (ev.getAction() == MotionEvent.ACTION_DOWN) onHotspotTap();
            return true;
        });
        root.addView(hotspot, new FrameLayout.LayoutParams(dp(64), dp(64), Gravity.TOP | Gravity.START));

        setContentView(root);
    }

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " UjianAman/" + NativeBridge.VERSION);
        web.addJavascriptInterface(new NativeBridge(this), "UjianAman");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (UrlGuard.isSameOrigin(url, origin)) return false;
                Toast.makeText(MainActivity.this, "Alamat di luar server sekolah diblokir", Toast.LENGTH_SHORT).show();
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                errorView.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    errorView.setText("Tidak dapat terhubung ke server sekolah.\n\n" + origin + "\n\nPeriksa koneksi internet/Wi-Fi, lalu ketuk layar untuk mencoba lagi.");
                    errorView.setVisibility(View.VISIBLE);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String o, GeolocationPermissions.Callback callback) {
                runOnUiThread(() -> handleWebGeolocation(o, callback));
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    permissionFlow = true;
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (RuntimeException e) {
                    fileCallback = null;
                    permissionFlow = false;
                    return false;
                }
                return true;
            }
        });
    }

    // ---------- Izin (kamera / lokasi untuk halaman web) ----------

    private void handleWebPermission(PermissionRequest request) {
        if (!UrlGuard.isSameOrigin(request.getOrigin().toString(), origin)) {
            request.deny();
            return;
        }
        boolean wantsVideo = false;
        for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsVideo = true;
        if (!wantsVideo) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            pendingWebPermission = request;
            permissionFlow = true;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }

    private void handleWebGeolocation(String o, GeolocationPermissions.Callback callback) {
        if (!UrlGuard.isSameOrigin(o, origin)) {
            callback.invoke(o, false, false);
            return;
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            callback.invoke(o, true, false);
        } else {
            pendingGeoCallback = callback;
            pendingGeoOrigin = o;
            permissionFlow = true;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION_WEB);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (code == REQ_CAMERA && pendingWebPermission != null) {
            if (granted) pendingWebPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingWebPermission.deny();
            pendingWebPermission = null;
        } else if (code == REQ_LOCATION_WEB && pendingGeoCallback != null) {
            pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
            pendingGeoCallback = null;
        } else if (code == REQ_LOCATION_BRIDGE && pendingLocationId != null) {
            String id = pendingLocationId;
            pendingLocationId = null;
            if (granted) fetchLocation(id);
            else deliverLocation(id, LocationJson.error("Izin lokasi ditolak"));
        }
        endPermissionFlowSoon();
    }

    private void endPermissionFlowSoon() {
        ui.postDelayed(() -> permissionFlow = false, 700);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
        endPermissionFlowSoon();
    }

    // ---------- Jembatan: mode ujian & lokasi ----------

    void onEnterExam() {
        if (examActive) return;
        examActive = true;
        examSince = System.currentTimeMillis();
        lockLostReported = false;
        pendingLeave = false;
        kiosk.enter(this);
        ui.postDelayed(monitor, MONITOR_MS);
    }

    void onExitExam() {
        examActive = false;
        ui.removeCallbacks(monitor);
        kiosk.exit(this);
    }

    void onRequestLocation(String id) {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            fetchLocation(id);
        } else {
            pendingLocationId = id;
            permissionFlow = true;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION_BRIDGE);
        }
    }

    private void fetchLocation(String id) {
        LocationHelper.getCurrent(this, json -> deliverLocation(id, json));
    }

    private void deliverLocation(String id, String json) {
        if (!LocationJson.isSafeId(id)) return;
        // json adalah literal objek JavaScript yang valid dan dibangun oleh LocationJson (nilai di-escape)
        web.evaluateJavascript("window.__ujianAmanLocation&&window.__ujianAmanLocation('" + id + "'," + json + ")", null);
    }

    /** kind hanya dari daftar tetap di bawah, sehingga aman disisipkan ke skrip. */
    private void sendEvent(String kind) {
        web.evaluateJavascript("window.__ujianAmanEvent&&window.__ujianAmanEvent('" + kind + "')", null);
    }

    // ---------- Deteksi pelanggaran saat ujian ----------

    @Override
    protected void onPause() {
        super.onPause();
        if (examActive && !permissionFlow) pendingLeave = true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        flushLeave();
        if (examActive && !kiosk.isLocked(this)) kiosk.enter(this);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!examActive) return;
        if (!hasFocus && !permissionFlow) pendingLeave = true;
        else if (hasFocus) flushLeave();
    }

    private void flushLeave() {
        if (examActive && pendingLeave) {
            pendingLeave = false;
            sendEvent("keluar_aplikasi");
        }
    }

    @Override
    public void onMultiWindowModeChanged(boolean isInMultiWindowMode, Configuration newConfig) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig);
        if (examActive && isInMultiWindowMode) sendEvent("split_screen");
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (examActive) return;               // tombol kembali tidak berfungsi saat ujian
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(monitor);
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }

    // ---------- Menu proktor (PIN) ----------

    private void onHotspotTap() {
        long now = System.currentTimeMillis();
        if (tapCount == 0 || now - firstTap > 5000) {
            tapCount = 0;
            firstTap = now;
        }
        if (++tapCount >= 7) {
            tapCount = 0;
            askPin();
        }
    }

    private void askPin() {
        long now = System.currentTimeMillis();
        if (now < pinBlockedUntil) {
            Toast.makeText(this, "Terlalu banyak PIN salah. Tunggu " + ((pinBlockedUntil - now) / 1000 + 1) + " detik.", Toast.LENGTH_SHORT).show();
            return;
        }
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        input.setHint("PIN proktor");
        permissionFlow = true;
        new AlertDialog.Builder(this)
                .setTitle("Menu proktor")
                .setView(input)
                .setPositiveButton("Buka", (d, w) -> {
                    if (prefs.checkPin(input.getText().toString())) {
                        wrongPins = 0;
                        showAdminMenu();
                    } else if (++wrongPins >= 5) {
                        wrongPins = 0;
                        pinBlockedUntil = System.currentTimeMillis() + 30000;
                        Toast.makeText(this, "PIN salah 5 kali. Dikunci 30 detik.", Toast.LENGTH_LONG).show();
                    } else {
                        Toast.makeText(this, "PIN salah", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("Batal", null)
                .setOnDismissListener(d -> endPermissionFlowSoon())
                .show();
    }

    private void showAdminMenu() {
        List<String> items = new ArrayList<>();
        items.add("Muat ulang halaman");
        items.add("Lepas mode ujian (keluar kiosk)");
        items.add("Pengaturan server / PIN");
        items.add(kiosk.hasDndAccess(this) ? "Jangan Ganggu: sudah diizinkan" : "Izinkan mode Jangan Ganggu (opsional)");
        items.add("Tutup aplikasi");
        permissionFlow = true;
        new AlertDialog.Builder(this)
                .setTitle("Menu proktor")
                .setItems(items.toArray(new String[0]), (d, which) -> {
                    switch (which) {
                        case 0:
                            web.reload();
                            break;
                        case 1:
                            onExitExam();
                            break;
                        case 2:
                            startActivity(new Intent(this, SetupActivity.class));
                            finish();
                            break;
                        case 3:
                            if (!kiosk.hasDndAccess(this)) startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
                            break;
                        default:
                            onExitExam();
                            finishAndRemoveTask();
                    }
                })
                .setOnDismissListener(d -> endPermissionFlowSoon())
                .show();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
