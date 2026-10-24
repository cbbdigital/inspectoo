# Inspecto — Widget Android (3 mărimi) + deep-link

Widgetul citește **direct din Supabase** (folosind sesiunea salvată de aplicație în
`SharedPreferences "CapacitorStorage"`, cheia `inspecto_session`, scrisă de `boot.js`).

- **Mic (2×2):** 2 butoane — *Programare* și *Fotografii*.
- **Lat (4×2):** inspecțiile de azi (max 3) + cele 2 butoane.
- **Mare (4×4):** inspecțiile de azi (max 6), mai detaliat, + cele 2 butoane.

Butoanele deschid aplicația la acțiunea corectă prin hash (`#new` / `#photos` / `#today`),
pe care îl prinde handler-ul web deja adăugat în `dashboard.html`.

---

## 0. Pregătire (o singură dată, în folderul proiectului)

```bash
# plugin-ul care partajează sesiunea cu widgetul
npm install @capacitor/preferences
# adaugă platforma Android (dacă nu e deja)
npx cap add android
npm run build
npx cap sync
```

`appId` este `ro.inspectoo.app` (din `capacitor.config.ts`). Peste tot mai jos
pachetul este **`ro.inspectoo.app`** — dacă îl schimbi, schimbă-l și în fișiere.

Deschide Android Studio: `npx cap open android`.

---

## 1. MainActivity care primește acțiunea din widget

Înlocuiește conținutul fișierului
`android/app/src/main/java/ro/inspectoo/app/MainActivity.java`
(sau `.kt`) — dacă e `.java`, șterge-l și creează `MainActivity.kt` cu:

```kotlin
package ro.inspectoo.app

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleAction(intent)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAction(intent)
    }
    private fun handleAction(intent: Intent?) {
        val action = intent?.getStringExtra("inspecto_action") ?: return
        if (action.isBlank()) return
        // setează hash-ul după ce pagina s-a încărcat; handler-ul web (hashchange) deschide acțiunea
        val js = "location.hash='#$action'"
        val wv = bridge?.webView ?: return
        wv.postDelayed({ wv.evaluateJavascript(js, null) }, 1200)
        wv.postDelayed({ wv.evaluateJavascript(js, null) }, 2500) // retry dacă pagina s-a încărcat mai greu
    }
}
```

> Dacă proiectul are `MainActivity.java`, în Android Studio: Refactor → convertește
> sau pur și simplu șterge `.java` și adaugă `.kt` de mai sus. Capacitor îl găsește după nume.

---

## 2. Providerul de widget (Kotlin)

Creează `android/app/src/main/java/ro/inspectoo/app/InspectoWidgetProvider.kt`:

```kotlin
package ro.inspectoo.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*

class InspectoWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) renderWidget(context, mgr, id)
    }
    override fun onAppWidgetOptionsChanged(
        context: Context, mgr: AppWidgetManager, id: Int, newOptions: Bundle
    ) { renderWidget(context, mgr, id) }

    private fun actionIntent(context: Context, action: String): PendingIntent {
        val i = Intent(context, MainActivity::class.java).apply {
            putExtra("inspecto_action", action)
            data = Uri.parse("inspecto://$action")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            context, action.hashCode(), i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun renderWidget(context: Context, mgr: AppWidgetManager, id: Int) {
        val opt = mgr.getAppWidgetOptions(id)
        val w = opt.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
        val h = opt.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)
        val layout = when {
            h >= 200 -> R.layout.widget_large
            w >= 220 -> R.layout.widget_medium
            else -> R.layout.widget_small
        }
        // randare rapidă (butoane) imediat
        mgr.updateAppWidget(id, baseViews(context, layout))

        if (layout == R.layout.widget_small) return
        // apoi încarcă lista de azi în fundal
        Thread {
            val rows = try { loadToday(context) } catch (e: Exception) { null }
            mgr.updateAppWidget(id, listViews(context, layout, rows))
        }.start()
    }

    private fun baseViews(context: Context, layout: Int): RemoteViews {
        val rv = RemoteViews(context.packageName, layout)
        rv.setOnClickPendingIntent(R.id.btn_new, actionIntent(context, "new"))
        rv.setOnClickPendingIntent(R.id.btn_photos, actionIntent(context, "photos"))
        if (layout != R.layout.widget_small)
            rv.setOnClickPendingIntent(R.id.header, actionIntent(context, "today"))
        return rv
    }

    private fun listViews(context: Context, layout: Int, rows: List<Row>?): RemoteViews {
        val rv = baseViews(context, layout)
        val maxRows = if (layout == R.layout.widget_large) 6 else 3
        val rowIds = intArrayOf(R.id.row0, R.id.row1, R.id.row2, R.id.row3, R.id.row4, R.id.row5)
        val tIds = intArrayOf(R.id.t0, R.id.t1, R.id.t2, R.id.t3, R.id.t4, R.id.t5)
        val nIds = intArrayOf(R.id.n0, R.id.n1, R.id.n2, R.id.n3, R.id.n4, R.id.n5)
        val pIds = intArrayOf(R.id.p0, R.id.p1, R.id.p2, R.id.p3, R.id.p4, R.id.p5)
        when {
            rows == null -> { rv.setViewVisibility(R.id.empty, View.VISIBLE)
                rv.setTextViewText(R.id.empty, "Nu s-au putut încărca datele") }
            rows.isEmpty() -> { rv.setViewVisibility(R.id.empty, View.VISIBLE)
                rv.setTextViewText(R.id.empty, "Nicio inspecție azi") }
            else -> rv.setViewVisibility(R.id.empty, View.GONE)
        }
        rv.setTextViewText(R.id.count, if (rows != null) "${rows.size}" else "")
        for (i in 0 until maxRows) {
            if (rows != null && i < rows.size) {
                rv.setViewVisibility(rowIds[i], View.VISIBLE)
                rv.setTextViewText(tIds[i], rows[i].time)
                rv.setTextViewText(nIds[i], rows[i].name)
                rv.setTextViewText(pIds[i], rows[i].plate)
            } else rv.setViewVisibility(rowIds[i], View.GONE)
        }
        return rv
    }

    data class Row(val time: String, val name: String, val plate: String)

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)

    private fun loadToday(context: Context): List<Row> {
        val sp = prefs(context)
        val raw = sp.getString("inspecto_session", null) ?: return emptyList()
        val ses = JSONObject(raw)
        val base = ses.optString("url"); val anon = ses.optString("anonKey")
        var token = ses.optString("access_token")
        if (base.isBlank() || anon.isBlank()) return emptyList()
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val path = "/rest/v1/appointments?select=client_name,license_plate," +
            "appointment_time,status&appointment_date=eq.$today&order=appointment_time.asc"
        var body = httpGet("$base$path", anon, token)
        if (body == null) { // token expirat → refresh → retry
            token = refreshToken(base, anon, ses, sp) ?: return emptyList()
            body = httpGet("$base$path", anon, token) ?: return emptyList()
        }
        val arr = JSONArray(body)
        val out = ArrayList<Row>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val st = o.optString("status")
            if (st == "cancelled" || st == "canceled" || st == "anulat") continue
            val t = o.optString("appointment_time").take(5)
            out.add(Row(
                if (t.isBlank()) "—" else t,
                o.optString("client_name").ifBlank { "—" },
                o.optString("license_plate")
            ))
        }
        return out
    }

    /** GET; întoarce body, sau null la 401 (token expirat) */
    private fun httpGet(urlStr: String, anon: String, token: String): String? {
        val c = (URL(urlStr).openConnection() as HttpURLConnection)
        c.requestMethod = "GET"
        c.setRequestProperty("apikey", anon)
        c.setRequestProperty("Authorization", "Bearer $token")
        c.connectTimeout = 8000; c.readTimeout = 8000
        return try {
            if (c.responseCode == 401) null
            else c.inputStream.bufferedReader().use { it.readText() }
        } catch (e: Exception) { null } finally { c.disconnect() }
    }

    private fun refreshToken(base: String, anon: String, ses: JSONObject, sp: SharedPreferences): String? {
        val rt = ses.optString("refresh_token"); if (rt.isBlank()) return null
        val c = (URL("$base/auth/v1/token?grant_type=refresh_token").openConnection() as HttpURLConnection)
        c.requestMethod = "POST"
        c.setRequestProperty("apikey", anon)
        c.setRequestProperty("Content-Type", "application/json")
        c.doOutput = true; c.connectTimeout = 8000; c.readTimeout = 8000
        return try {
            c.outputStream.use { it.write("{\"refresh_token\":\"$rt\"}".toByteArray()) }
            if (c.responseCode != 200) return null
            val resp = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
            val newAccess = resp.optString("access_token")
            ses.put("access_token", newAccess)
            ses.put("refresh_token", resp.optString("refresh_token", rt))
            sp.edit().putString("inspecto_session", ses.toString()).apply()
            newAccess
        } catch (e: Exception) { null } finally { c.disconnect() }
    }
}
```

---

## 3. Fundal rotunjit + culori

`android/app/src/main/res/drawable/widget_bg.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FFFFFFFF" />
    <corners android:radius="22dp" />
</shape>
```

`android/app/src/main/res/drawable/btn_primary.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FF1452E6" />
    <corners android:radius="16dp" />
</shape>
```

`android/app/src/main/res/drawable/btn_soft.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FFEEF2FB" />
    <corners android:radius="16dp" />
</shape>
```

---

## 4. Layout-uri

`res/layout/widget_small.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical" android:background="@drawable/widget_bg"
    android:padding="10dp" android:gravity="center">
    <TextView android:id="@+id/btn_new"
        android:layout_width="match_parent" android:layout_height="0dp"
        android:layout_weight="1" android:layout_marginBottom="6dp"
        android:background="@drawable/btn_primary" android:gravity="center"
        android:text="Programare" android:textColor="#FFFFFFFF"
        android:textStyle="bold" android:textSize="13sp" />
    <TextView android:id="@+id/btn_photos"
        android:layout_width="match_parent" android:layout_height="0dp"
        android:layout_weight="1"
        android:background="@drawable/btn_soft" android:gravity="center"
        android:text="Fotografii" android:textColor="#FF101B2E"
        android:textStyle="bold" android:textSize="13sp" />
</LinearLayout>
```

`res/layout/widget_medium.xml` (header + 3 rânduri + 2 butoane):
```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical" android:background="@drawable/widget_bg"
    android:padding="12dp">
    <LinearLayout android:id="@+id/header"
        android:layout_width="match_parent" android:layout_height="wrap_content"
        android:orientation="horizontal" android:gravity="center_vertical">
        <TextView android:layout_width="0dp" android:layout_height="wrap_content"
            android:layout_weight="1" android:text="Inspecții azi"
            android:textColor="#FF101B2E" android:textStyle="bold" android:textSize="14sp" />
        <TextView android:id="@+id/count" android:layout_width="wrap_content"
            android:layout_height="wrap_content" android:text=""
            android:textColor="#FF1452E6" android:textStyle="bold" android:textSize="14sp" />
    </LinearLayout>
    <TextView android:id="@+id/empty" android:layout_width="match_parent"
        android:layout_height="wrap_content" android:text="" android:visibility="gone"
        android:textColor="#FF64748B" android:textSize="12sp" android:paddingTop="6dp" />
    <!-- rânduri -->
    <include layout="@layout/widget_row" android:id="@+id/row0" />
    <include layout="@layout/widget_row" android:id="@+id/row1" />
    <include layout="@layout/widget_row" android:id="@+id/row2" />
    <View android:layout_width="match_parent" android:layout_height="0dp"
        android:layout_weight="1" />
    <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content"
        android:orientation="horizontal" android:layout_marginTop="8dp">
        <TextView android:id="@+id/btn_new" android:layout_width="0dp"
            android:layout_height="40dp" android:layout_weight="1" android:layout_marginEnd="6dp"
            android:background="@drawable/btn_primary" android:gravity="center"
            android:text="Programare" android:textColor="#FFFFFFFF" android:textStyle="bold" android:textSize="12sp" />
        <TextView android:id="@+id/btn_photos" android:layout_width="0dp"
            android:layout_height="40dp" android:layout_weight="1"
            android:background="@drawable/btn_soft" android:gravity="center"
            android:text="Fotografii" android:textColor="#FF101B2E" android:textStyle="bold" android:textSize="12sp" />
    </LinearLayout>
</LinearLayout>
```

`res/layout/widget_large.xml` — la fel ca medium, dar cu 6 rânduri:
```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical" android:background="@drawable/widget_bg" android:padding="14dp">
    <LinearLayout android:id="@+id/header"
        android:layout_width="match_parent" android:layout_height="wrap_content"
        android:orientation="horizontal" android:gravity="center_vertical">
        <TextView android:layout_width="0dp" android:layout_height="wrap_content"
            android:layout_weight="1" android:text="Programul zilei"
            android:textColor="#FF101B2E" android:textStyle="bold" android:textSize="16sp" />
        <TextView android:id="@+id/count" android:layout_width="wrap_content"
            android:layout_height="wrap_content" android:text=""
            android:textColor="#FF1452E6" android:textStyle="bold" android:textSize="16sp" />
    </LinearLayout>
    <TextView android:id="@+id/empty" android:layout_width="match_parent"
        android:layout_height="wrap_content" android:text="" android:visibility="gone"
        android:textColor="#FF64748B" android:textSize="13sp" android:paddingTop="8dp" />
    <include layout="@layout/widget_row" android:id="@+id/row0" />
    <include layout="@layout/widget_row" android:id="@+id/row1" />
    <include layout="@layout/widget_row" android:id="@+id/row2" />
    <include layout="@layout/widget_row" android:id="@+id/row3" />
    <include layout="@layout/widget_row" android:id="@+id/row4" />
    <include layout="@layout/widget_row" android:id="@+id/row5" />
    <View android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" />
    <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content"
        android:orientation="horizontal" android:layout_marginTop="10dp">
        <TextView android:id="@+id/btn_new" android:layout_width="0dp"
            android:layout_height="46dp" android:layout_weight="1" android:layout_marginEnd="8dp"
            android:background="@drawable/btn_primary" android:gravity="center"
            android:text="Programare nouă" android:textColor="#FFFFFFFF" android:textStyle="bold" android:textSize="13sp" />
        <TextView android:id="@+id/btn_photos" android:layout_width="0dp"
            android:layout_height="46dp" android:layout_weight="1"
            android:background="@drawable/btn_soft" android:gravity="center"
            android:text="Fotografii" android:textColor="#FF101B2E" android:textStyle="bold" android:textSize="13sp" />
    </LinearLayout>
</LinearLayout>
```

Rândul reutilizabil `res/layout/widget_row.xml` — **atenție:** `<include>` nu
suportă ca fiecare rând să aibă ID-uri diferite pentru copii. De aceea NU folosim
include cu copii cu ID; în loc, pune rândurile direct în layout. Înlocuiește cele 3/6
linii `<include .../>` de mai sus cu blocuri de forma următoare, schimbând sufixul
`0..5` la fiecare (row0/t0/n0/p0, row1/t1/n1/p1, ...):

```xml
<LinearLayout android:id="@+id/row0"
    android:layout_width="match_parent" android:layout_height="wrap_content"
    android:orientation="horizontal" android:gravity="center_vertical"
    android:paddingTop="7dp" android:paddingBottom="7dp" android:visibility="gone">
    <TextView android:id="@+id/t0" android:layout_width="44dp" android:layout_height="wrap_content"
        android:text="" android:textColor="#FF1452E6" android:textStyle="bold" android:textSize="13sp" />
    <TextView android:id="@+id/n0" android:layout_width="0dp" android:layout_height="wrap_content"
        android:layout_weight="1" android:text="" android:maxLines="1" android:ellipsize="end"
        android:textColor="#FF101B2E" android:textSize="13sp" android:paddingStart="6dp" />
    <TextView android:id="@+id/p0" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="" android:textColor="#FF64748B" android:textSize="12sp" />
</LinearLayout>
```

> Practic: copiază blocul de mai sus de 3 ori în `widget_medium.xml` (sufixe 0,1,2)
> și de 6 ori în `widget_large.xml` (sufixe 0..5), în locul liniilor `<include>`.

---

## 5. Definiția widget-ului

`res/xml/inspecto_widget_info.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="110dp" android:minHeight="110dp"
    android:targetCellWidth="2" android:targetCellHeight="2"
    android:resizeMode="horizontal|vertical"
    android:widgetCategory="home_screen"
    android:initialLayout="@layout/widget_small"
    android:updatePeriodMillis="1800000" />
```

---

## 6. Manifest

În `android/app/src/main/AndroidManifest.xml`, în interiorul `<application>`,
adaugă (lângă `<activity>`-ul existent):

```xml
<receiver android:name=".InspectoWidgetProvider" android:exported="true">
    <intent-filter>
        <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
    </intent-filter>
    <meta-data android:name="android.appwidget.provider"
        android:resource="@xml/inspecto_widget_info" />
</receiver>
```

Asigură-te că `<activity android:name=".MainActivity" ...>` are
`android:launchMode="singleTask"` (ca să primească `onNewIntent`). Dacă nu, adaugă-l.

---

## 7. Build & test

```bash
npm run build && npx cap sync
npx cap open android
```
În Android Studio: **Run** pe un emulator/telefon. Apoi:
1. Loghează-te în aplicație (ca să se scrie sesiunea în `inspecto_session`).
2. Pe ecranul de start, ține apăsat → Widgets → Inspecto → trage mărimea dorită.
3. Butoanele deschid aplicația la Programare / Fotografii; lista arată inspecțiile de azi.

> Widgetul se reîmprospătează la ~30 min (minimul Android) și la redimensionare.
> Pentru refresh mai des ar trebui un `WorkManager` periodic (opțional, etapă ulterioară).

---

## Note / limitări
- Widgetul vede datele doar **după ce te-ai logat o dată** în app (atunci se salvează sesiunea).
- Dacă tokenul expiră, widgetul îl reîmprospătează automat din `refresh_token`.
- Interogarea respectă RLS: vezi doar programările tale.
- Culorile sunt fixe (temă deschisă). Pot adăuga variantă dark pentru widget separat.
