package id.sch.ujianaman;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class LocationJsonTest {
    @Test
    public void hasilLokasiBerformatJsonDenganPenandaMock() {
        assertEquals("{\"ok\":true,\"lat\":-6.2,\"lng\":106.8,\"accuracy\":12.5,\"mock\":false}", LocationJson.ok(-6.2, 106.8, 12.5, false));
        assertTrue(LocationJson.ok(-6.2, 106.8, 12.5, true).endsWith("\"mock\":true}"));
    }

    @Test
    public void nilaiTakValidMenjadiGalat() {
        assertEquals("{\"ok\":false,\"error\":\"Lokasi tidak valid\"}", LocationJson.ok(Double.NaN, 1, 1, false));
        assertEquals("{\"ok\":false,\"error\":\"Lokasi tidak valid\"}", LocationJson.ok(1, Double.POSITIVE_INFINITY, 1, false));
        assertTrue(LocationJson.ok(1, 2, Double.NaN, false).contains("\"accuracy\":-1.0"));
    }

    @Test
    public void pesanGalatDiEscape() {
        assertEquals("{\"ok\":false,\"error\":\"a\\\"b\\\\c\\nd\"}", LocationJson.error("a\"b\\c\nd"));
        assertEquals("{\"ok\":false,\"error\":\"\"}", LocationJson.error(null));
        assertFalse(LocationJson.error("</script> ").contains(" "));
    }

    @Test
    public void idPermintaanHanyaKarakterAman() {
        assertTrue(LocationJson.isSafeId("loc_1-A"));
        assertFalse(LocationJson.isSafeId(""));
        assertFalse(LocationJson.isSafeId("a'b"));
        assertFalse(LocationJson.isSafeId("a);alert(1);//"));
        assertFalse(LocationJson.isSafeId(null));
        assertFalse(LocationJson.isSafeId("x".repeat(41)));
    }
}
