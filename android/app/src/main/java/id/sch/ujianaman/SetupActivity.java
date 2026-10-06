package id.sch.ujianaman;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Pengaturan awal / ubah: alamat server sekolah dan PIN proktor. */
public class SetupActivity extends Activity {
    private Prefs prefs;
    private EditText server;
    private EditText pin;
    private EditText pin2;
    private TextView error;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);

        int pad = dp(24);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, pad);

        TextView title = text("Pengaturan Ujian Aman", 22, Color.WHITE, true);
        TextView hint = text("Isi alamat server sekolah dan buat PIN proktor (4-8 angka). PIN dipakai untuk membuka pengaturan atau keluar dari mode ujian.", 14, Color.parseColor("#A9B2D8"), false);

        server = field("Alamat server, mis. absen.sekolah.sch.id", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        if (prefs.origin() != null) server.setText(prefs.origin());
        pin = field(prefs.hasPin() ? "PIN baru (kosongkan bila tidak diubah)" : "PIN proktor (4-8 angka)", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        pin2 = field("Ulangi PIN", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);

        error = text("", 14, Color.parseColor("#FFB4C0"), false);
        Button save = new Button(this);
        save.setText("Simpan dan buka");
        save.setOnClickListener(v -> save());

        box.addView(title);
        box.addView(hint, space());
        box.addView(server, space());
        box.addView(pin, space());
        box.addView(pin2, space());
        box.addView(error, space());
        box.addView(save, space());

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.parseColor("#060918"));
        sv.setFillViewport(true);
        sv.addView(box);
        setContentView(sv);
    }

    private void save() {
        String origin = UrlGuard.normalizeOrigin(server.getText().toString());
        if (origin == null) {
            error.setText("Alamat server tidak valid. Contoh: absen.sekolah.sch.id");
            return;
        }
        String p = pin.getText().toString();
        String p2 = pin2.getText().toString();
        boolean needPin = !prefs.hasPin() || !p.isEmpty();
        if (needPin) {
            if (!PinHash.isValidPin(p)) {
                error.setText("PIN harus 4-8 angka");
                return;
            }
            if (!p.equals(p2)) {
                error.setText("Ulangi PIN tidak sama");
                return;
            }
        }
        prefs.saveOrigin(origin);
        if (needPin) prefs.savePin(p);
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(i);
        finish();
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        return t;
    }

    private EditText field(String hint, int inputType) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setInputType(inputType);
        e.setTextColor(Color.WHITE);
        e.setHintTextColor(Color.parseColor("#7F89B5"));
        e.setSingleLine(true);
        return e;
    }

    private LinearLayout.LayoutParams space() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(14);
        return lp;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
