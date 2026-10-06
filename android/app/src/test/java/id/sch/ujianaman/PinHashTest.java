package id.sch.ujianaman;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PinHashTest {
    @Test
    public void validasiFormatPin() {
        assertTrue(PinHash.isValidPin("1234"));
        assertTrue(PinHash.isValidPin("12345678"));
        assertFalse(PinHash.isValidPin("123"));
        assertFalse(PinHash.isValidPin("123456789"));
        assertFalse(PinHash.isValidPin("12a4"));
        assertFalse(PinHash.isValidPin(""));
        assertFalse(PinHash.isValidPin(null));
    }

    @Test
    public void hashDeterministikTergantungGaramDanPin() {
        String salt = PinHash.newSalt();
        assertEquals(32, salt.length());
        assertEquals(PinHash.hash("1234", salt), PinHash.hash("1234", salt));
        assertNotEquals(PinHash.hash("1234", salt), PinHash.hash("1235", salt));
        assertNotEquals(PinHash.hash("1234", salt), PinHash.hash("1234", PinHash.newSalt()));
        assertEquals(64, PinHash.hash("1234", salt).length());
        assertFalse(PinHash.hash("1234", salt).contains("1234"));
    }

    @Test
    public void verifikasi() {
        String salt = PinHash.newSalt();
        String h = PinHash.hash("2468", salt);
        assertTrue(PinHash.verify("2468", salt, h));
        assertFalse(PinHash.verify("2469", salt, h));
        assertFalse(PinHash.verify(null, salt, h));
        assertFalse(PinHash.verify("2468", null, h));
        assertFalse(PinHash.verify("2468", salt, null));
    }
}
