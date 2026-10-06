package id.sch.ujianaman;

import android.content.Context;
import android.content.SharedPreferences;

/** Penyimpanan pengaturan: alamat server dan PIN proktor (hash). */
final class Prefs {
    private final SharedPreferences sp;

    Prefs(Context c) {
        sp = c.getSharedPreferences("ujian_aman", Context.MODE_PRIVATE);
    }

    String origin() {
        return sp.getString("origin", null);
    }

    boolean hasPin() {
        return sp.getString("pin_hash", null) != null;
    }

    void saveOrigin(String origin) {
        sp.edit().putString("origin", origin).apply();
    }

    void savePin(String pin) {
        String salt = PinHash.newSalt();
        sp.edit().putString("pin_salt", salt).putString("pin_hash", PinHash.hash(pin, salt)).apply();
    }

    boolean checkPin(String pin) {
        return PinHash.verify(pin, sp.getString("pin_salt", null), sp.getString("pin_hash", null));
    }
}
