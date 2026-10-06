package id.sch.ujianaman;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.view.WindowManager;

/**
 * Mode ujian: sematkan layar (lock task), cegah tangkapan layar, jaga layar menyala, dan (bila diizinkan)
 * aktifkan "Jangan Ganggu" agar notifikasi tidak muncul. Semua bagian bersifat "best effort":
 * tanpa Device Owner, penyematan layar masih bisa dilepas pengguna dengan gestur sistem; aplikasi mendeteksinya.
 */
final class KioskController {
    private int savedFilter = -1;

    void enter(Activity a) {
        a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        try {
            a.startLockTask();
        } catch (RuntimeException e) {
            // sistem menolak; isLocked() akan false dan MainActivity melaporkannya
        }
        NotificationManager nm = (NotificationManager) a.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && nm.isNotificationPolicyAccessGranted() && savedFilter < 0) {
            savedFilter = nm.getCurrentInterruptionFilter();
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_NONE);
        }
    }

    void exit(Activity a) {
        try {
            a.stopLockTask();
        } catch (RuntimeException e) {
            // tidak sedang disematkan
        }
        a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        NotificationManager nm = (NotificationManager) a.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && savedFilter >= 0 && nm.isNotificationPolicyAccessGranted()) {
            nm.setInterruptionFilter(savedFilter);
        }
        savedFilter = -1;
    }

    boolean isLocked(Activity a) {
        ActivityManager am = (ActivityManager) a.getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return false;
        return am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    boolean hasDndAccess(Activity a) {
        NotificationManager nm = (NotificationManager) a.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.isNotificationPolicyAccessGranted();
    }
}
