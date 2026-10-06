package id.sch.ujianaman;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UrlGuardTest {
    @Test
    public void menambahkanHttpsDanMenormalkanHuruf() {
        assertEquals("https://absen.sekolah.sch.id", UrlGuard.normalizeOrigin("  Absen.Sekolah.SCH.id "));
        assertEquals("https://absen.sekolah.sch.id", UrlGuard.normalizeOrigin("https://absen.sekolah.sch.id/"));
        assertEquals("https://absen.sekolah.sch.id", UrlGuard.normalizeOrigin("https://absen.sekolah.sch.id/#/ujian?x=1"));
    }

    @Test
    public void portBawaanDibuangPortLainDipertahankan() {
        assertEquals("https://a.id", UrlGuard.normalizeOrigin("https://a.id:443"));
        assertEquals("http://a.id", UrlGuard.normalizeOrigin("http://a.id:80"));
        assertEquals("http://192.168.1.5:3000", UrlGuard.normalizeOrigin("192.168.1.5:3000".startsWith("http") ? "192.168.1.5:3000" : "http://192.168.1.5:3000"));
    }

    @Test
    public void menolakInputTidakValid() {
        assertNull(UrlGuard.normalizeOrigin(null));
        assertNull(UrlGuard.normalizeOrigin(""));
        assertNull(UrlGuard.normalizeOrigin("   "));
        assertNull(UrlGuard.normalizeOrigin("ftp://a.id"));
        assertNull(UrlGuard.normalizeOrigin("javascript:alert(1)"));
        assertNull(UrlGuard.normalizeOrigin("file:///sdcard/x.html"));
        assertNull(UrlGuard.normalizeOrigin("https://"));
        assertNull(UrlGuard.normalizeOrigin("https://a b.id"));
    }

    @Test
    public void originSamaHanyaUntukSkemaHostPortYangSama() {
        String o = "https://absen.sekolah.sch.id";
        assertTrue(UrlGuard.isSameOrigin("https://absen.sekolah.sch.id/api/me", o));
        assertTrue(UrlGuard.isSameOrigin("https://ABSEN.sekolah.sch.id:443/#/ujian", o));
        assertFalse(UrlGuard.isSameOrigin("http://absen.sekolah.sch.id/", o));
        assertFalse(UrlGuard.isSameOrigin("https://absen.sekolah.sch.id:8443/", o));
        assertFalse(UrlGuard.isSameOrigin("https://evil.com/", o));
        assertFalse(UrlGuard.isSameOrigin("https://absen.sekolah.sch.id.evil.com/", o));
        assertFalse(UrlGuard.isSameOrigin("https://evil.com/@absen.sekolah.sch.id", o));
        assertFalse(UrlGuard.isSameOrigin("https://absen.sekolah.sch.id@evil.com/", o));
        assertFalse(UrlGuard.isSameOrigin("javascript:alert(1)", o));
        assertFalse(UrlGuard.isSameOrigin(null, o));
    }

    @Test
    public void deteksiCleartext() {
        assertTrue(UrlGuard.isCleartext("http://192.168.1.5:3000"));
        assertFalse(UrlGuard.isCleartext("https://a.id"));
        assertFalse(UrlGuard.isCleartext(null));
    }
}
