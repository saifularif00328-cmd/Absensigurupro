package id.sch.ujianaman;

import java.net.URI;

/** Normalisasi alamat server dan pembatasan navigasi ke satu origin (skema + host + port). Logika murni, bisa diuji di JVM. */
public final class UrlGuard {
    private UrlGuard() {}

    /** "sekolah.sch.id" -> "https://sekolah.sch.id"; mengembalikan null bila bukan alamat http/https yang valid. */
    public static String normalizeOrigin(String input) {
        if (input == null) return null;
        String s = input.trim();
        if (s.isEmpty()) return null;
        if (!s.contains("://")) s = "https://" + s;
        URI u;
        try {
            u = new URI(s);
        } catch (Exception e) {
            return null;
        }
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
        if (!scheme.equals("http") && !scheme.equals("https")) return null;
        String host = u.getHost();
        if (host == null || host.isEmpty()) return null;
        int port = u.getPort();
        boolean defaultPort = port == -1 || (scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80);
        return scheme + "://" + host.toLowerCase() + (defaultPort ? "" : ":" + port);
    }

    /** True bila {@code url} berada di origin yang sama dengan {@code origin}. */
    public static boolean isSameOrigin(String url, String origin) {
        String a = normalizeOrigin(url);
        String b = normalizeOrigin(origin);
        return a != null && a.equals(b);
    }

    public static boolean isCleartext(String origin) {
        return origin != null && origin.startsWith("http://");
    }
}
