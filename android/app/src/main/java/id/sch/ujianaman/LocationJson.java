package id.sch.ujianaman;

import java.util.Locale;

/** Membangun JSON hasil lokasi yang dikirim ke halaman web. Logika murni, bisa diuji di JVM. */
public final class LocationJson {
    private LocationJson() {}

    public static String ok(double lat, double lng, double accuracy, boolean mock) {
        if (!finite(lat) || !finite(lng)) return error("Lokasi tidak valid");
        double acc = finite(accuracy) ? accuracy : -1;
        return String.format(Locale.US, "{\"ok\":true,\"lat\":%s,\"lng\":%s,\"accuracy\":%s,\"mock\":%s}",
                Double.toString(lat), Double.toString(lng), Double.toString(acc), mock ? "true" : "false");
    }

    public static String error(String message) {
        return "{\"ok\":false,\"error\":\"" + escape(message == null ? "" : message) + "\"}";
    }

    /** Id permintaan dari web hanya boleh huruf/angka/_/- (mencegah penyuntikan skrip). */
    public static boolean isSafeId(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{1,40}");
    }

    static String escape(String s) {
        StringBuilder sb = new StringBuilder();
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case ' ': sb.append("\\u2028"); break;
                case ' ': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c);
            }
        }
        return sb.toString();
    }

    private static boolean finite(double d) {
        return !Double.isNaN(d) && !Double.isInfinite(d);
    }
}
