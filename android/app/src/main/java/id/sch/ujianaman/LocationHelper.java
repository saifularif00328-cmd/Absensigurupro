package id.sch.ujianaman;

import android.annotation.SuppressLint;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.atomic.AtomicBoolean;

/** Satu kali pengambilan lokasi lewat LocationManager, termasuk penanda lokasi palsu (mock provider). */
final class LocationHelper {
    interface Callback {
        void done(String json);
    }

    private static final long TIMEOUT_MS = 20000;

    private LocationHelper() {}

    @SuppressLint("MissingPermission")
    static void getCurrent(Context ctx, Callback cb) {
        final LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) {
            cb.done(LocationJson.error("Layanan lokasi tidak tersedia"));
            return;
        }
        final String provider;
        if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) provider = LocationManager.GPS_PROVIDER;
        else if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) provider = LocationManager.NETWORK_PROVIDER;
        else {
            cb.done(LocationJson.error("Aktifkan GPS/lokasi di pengaturan perangkat"));
            return;
        }

        final AtomicBoolean finished = new AtomicBoolean(false);
        final Handler main = new Handler(Looper.getMainLooper());
        final CancellationSignal cancel = new CancellationSignal();
        final LocationListener[] legacy = new LocationListener[1];

        final Runnable timeout = () -> {
            if (finished.compareAndSet(false, true)) {
                cancel.cancel();
                if (legacy[0] != null) lm.removeUpdates(legacy[0]);
                cb.done(LocationJson.error("Lokasi tidak ditemukan. Coba di area terbuka."));
            }
        };
        main.postDelayed(timeout, TIMEOUT_MS);

        final java.util.function.Consumer<Location> deliver = loc -> {
            if (!finished.compareAndSet(false, true)) return;
            main.removeCallbacks(timeout);
            if (loc == null) {
                cb.done(LocationJson.error("Lokasi tidak ditemukan"));
                return;
            }
            cb.done(LocationJson.ok(loc.getLatitude(), loc.getLongitude(), loc.hasAccuracy() ? loc.getAccuracy() : -1, isMock(loc)));
        };

        if (Build.VERSION.SDK_INT >= 30) {
            lm.getCurrentLocation(provider, cancel, ctx.getMainExecutor(), deliver);
        } else {
            legacy[0] = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    deliver.accept(location);
                }

                @Override
                public void onProviderEnabled(String p) {}

                @Override
                public void onProviderDisabled(String p) {}

                @Override
                public void onStatusChanged(String p, int status, android.os.Bundle extras) {}
            };
            lm.requestSingleUpdate(provider, legacy[0], Looper.getMainLooper());
        }
    }

    @SuppressWarnings("deprecation")
    static boolean isMock(Location loc) {
        return Build.VERSION.SDK_INT >= 31 ? loc.isMock() : loc.isFromMockProvider();
    }
}
