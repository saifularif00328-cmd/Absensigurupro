package id.sch.ujianaman;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;

/** PIN proktor disimpan sebagai hash bergaram (SHA-256 berulang), bukan teks asli. */
public final class PinHash {
    private static final int ROUNDS = 20000;

    private PinHash() {}

    public static boolean isValidPin(String pin) {
        return pin != null && pin.matches("\\d{4,8}");
    }

    public static String newSalt() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        return toHex(b);
    }

    public static String hash(String pin, String saltHex) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] cur = (saltHex + ":" + pin).getBytes(StandardCharsets.UTF_8);
            for (int i = 0; i < ROUNDS; i++) {
                md.reset();
                md.update(cur);
                md.update(saltHex.getBytes(StandardCharsets.UTF_8));
                cur = md.digest();
            }
            return toHex(cur);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public static boolean verify(String pin, String saltHex, String expectedHex) {
        if (pin == null || saltHex == null || expectedHex == null) return false;
        return MessageDigest.isEqual(hash(pin, saltHex).getBytes(StandardCharsets.UTF_8), expectedHex.getBytes(StandardCharsets.UTF_8));
    }

    static String toHex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
