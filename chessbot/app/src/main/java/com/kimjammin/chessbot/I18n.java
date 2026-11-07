package com.kimjammin.chessbot;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Locale;

/** 다국어 문자열 (20개 언어) */
public final class I18n {
    public static final int START = 0, STOP = 1, LANG = 2, PERM_TITLE = 3, PERM_MSG = 4, OK = 5, CANCEL = 6,
            BOT_ON = 7, BOT_OFF = 8, NOTIF = 9, ACC = 10;

    public static final String[] CODES = {"ko", "en", "ja", "zh", "zh-TW", "es", "fr", "de", "it", "pt", "ru",
            "ar", "hi", "id", "vi", "th", "tr", "pl", "nl", "uk"};
    public static final String[] NAMES = {"한국어", "English", "日本語", "简体中文", "繁體中文", "Español", "Français",
            "Deutsch", "Italiano", "Português", "Русский", "العربية", "हिन्दी", "Bahasa Indonesia", "Tiếng Việt",
            "ไทย", "Türkçe", "Polski", "Nederlands", "Українська"};

    private static final String[][] S = {
            {"봇 시작하기", "멈추기", "언어", "권한 필요", "다른 앱 위에 창을 띄우려면 '다른 앱 위에 표시' 권한을 허용해 주세요.", "확인", "취소", "봇 작동하기", "봇 정지", "체스 봇 실행 중", "접근성 설정에서 'Chess Auto Bot'을 켜 주세요"},
            {"Start Bot", "Stop", "Language", "Permission needed", "Allow 'Display over other apps' so the window can float above other apps.", "OK", "Cancel", "Run Bot", "Pause Bot", "Chess bot is running", "Turn on 'Chess Auto Bot' in Accessibility settings"},
            {"ボット開始", "停止", "言語", "権限が必要です", "他のアプリの上にウィンドウを表示するため「他のアプリの上に重ねて表示」を許可してください。", "OK", "キャンセル", "ボット作動", "ボット停止", "チェスボット実行中", "ユーザー補助設定で「Chess Auto Bot」をオンにしてください"},
            {"启动机器人", "停止", "语言", "需要权限", "请允许“显示在其他应用上层”，以便窗口悬浮在其他应用之上。", "确定", "取消", "运行机器人", "暂停机器人", "象棋机器人运行中", "请在无障碍设置中开启“Chess Auto Bot”"},
            {"啟動機器人", "停止", "語言", "需要權限", "請允許「顯示在其他應用程式上層」，讓視窗浮在其他應用程式之上。", "確定", "取消", "執行機器人", "暫停機器人", "西洋棋機器人執行中", "請在無障礙設定中開啟「Chess Auto Bot」"},
            {"Iniciar bot", "Detener", "Idioma", "Permiso necesario", "Permite 'Mostrar sobre otras apps' para que la ventana flote sobre otras aplicaciones.", "Aceptar", "Cancelar", "Activar bot", "Pausar bot", "El bot de ajedrez está activo", "Activa 'Chess Auto Bot' en Accesibilidad"},
            {"Démarrer le bot", "Arrêter", "Langue", "Autorisation requise", "Autorisez « Afficher par-dessus les autres applis » pour que la fenêtre flotte.", "OK", "Annuler", "Lancer le bot", "Pause du bot", "Le bot d'échecs est actif", "Activez « Chess Auto Bot » dans Accessibilité"},
            {"Bot starten", "Stopp", "Sprache", "Berechtigung nötig", "Erlaube „Über anderen Apps einblenden“, damit das Fenster über anderen Apps schwebt.", "OK", "Abbrechen", "Bot aktivieren", "Bot pausieren", "Schachbot läuft", "Aktiviere „Chess Auto Bot“ unter Bedienungshilfen"},
            {"Avvia bot", "Ferma", "Lingua", "Permesso richiesto", "Consenti 'Mostra sopra altre app' per far fluttuare la finestra sopra le altre app.", "OK", "Annulla", "Attiva bot", "Pausa bot", "Il bot di scacchi è attivo", "Attiva 'Chess Auto Bot' in Accessibilità"},
            {"Iniciar bot", "Parar", "Idioma", "Permissão necessária", "Permita 'Sobrepor a outros apps' para a janela flutuar sobre outros aplicativos.", "OK", "Cancelar", "Ativar bot", "Pausar bot", "O bot de xadrez está ativo", "Ative 'Chess Auto Bot' em Acessibilidade"},
            {"Запустить бота", "Стоп", "Язык", "Нужно разрешение", "Разрешите «Поверх других приложений», чтобы окно отображалось поверх других программ.", "ОК", "Отмена", "Запустить бота", "Пауза бота", "Шахматный бот работает", "Включите «Chess Auto Bot» в Спец. возможностях"},
            {"تشغيل الروبوت", "إيقاف", "اللغة", "مطلوب إذن", "اسمح بـ«الظهور فوق التطبيقات الأخرى» لكي تطفو النافذة فوقها.", "موافق", "إلغاء", "تشغيل الروبوت", "إيقاف مؤقت", "روبوت الشطرنج يعمل", "فعّل «Chess Auto Bot» من إعدادات سهولة الاستخدام"},
            {"बॉट शुरू करें", "रोकें", "भाषा", "अनुमति चाहिए", "विंडो को दूसरे ऐप्स के ऊपर दिखाने के लिए 'अन्य ऐप्स पर दिखाएँ' की अनुमति दें।", "ठीक है", "रद्द करें", "बॉट चलाएँ", "बॉट रोकें", "शतरंज बॉट चल रहा है", "सुलभता सेटिंग में 'Chess Auto Bot' चालू करें"},
            {"Mulai Bot", "Berhenti", "Bahasa", "Izin diperlukan", "Izinkan 'Tampilkan di atas aplikasi lain' agar jendela melayang di atas aplikasi lain.", "OK", "Batal", "Jalankan Bot", "Jeda Bot", "Bot catur sedang berjalan", "Aktifkan 'Chess Auto Bot' di setelan Aksesibilitas"},
            {"Bật bot", "Dừng", "Ngôn ngữ", "Cần cấp quyền", "Hãy cho phép 'Hiển thị trên ứng dụng khác' để cửa sổ nổi trên các ứng dụng khác.", "OK", "Hủy", "Chạy bot", "Tạm dừng bot", "Bot cờ vua đang chạy", "Bật 'Chess Auto Bot' trong cài đặt Hỗ trợ tiếp cận"},
            {"เริ่มบอท", "หยุด", "ภาษา", "ต้องการสิทธิ์", "โปรดอนุญาต 'แสดงทับแอปอื่น' เพื่อให้หน้าต่างลอยอยู่เหนือแอปอื่น", "ตกลง", "ยกเลิก", "เปิดบอท", "พักบอท", "บอทหมากรุกกำลังทำงาน", "เปิด 'Chess Auto Bot' ในการตั้งค่าการช่วยเหลือพิเศษ"},
            {"Botu başlat", "Durdur", "Dil", "İzin gerekli", "Pencerenin diğer uygulamaların üstünde durması için 'Diğer uygulamaların üzerinde göster' iznini ver.", "Tamam", "İptal", "Botu çalıştır", "Botu duraklat", "Satranç botu çalışıyor", "Erişilebilirlik ayarlarında 'Chess Auto Bot'u aç"},
            {"Uruchom bota", "Zatrzymaj", "Język", "Wymagane uprawnienie", "Zezwól na „Wyświetlanie nad innymi aplikacjami”, aby okno unosiło się nad innymi aplikacjami.", "OK", "Anuluj", "Włącz bota", "Wstrzymaj bota", "Bot szachowy działa", "Włącz „Chess Auto Bot” w ustawieniach Ułatwień dostępu"},
            {"Bot starten", "Stoppen", "Taal", "Toestemming nodig", "Sta 'Weergeven boven andere apps' toe zodat het venster boven andere apps zweeft.", "OK", "Annuleren", "Bot activeren", "Bot pauzeren", "Schaakbot is actief", "Zet 'Chess Auto Bot' aan bij Toegankelijkheid"},
            {"Запустити бота", "Стоп", "Мова", "Потрібен дозвіл", "Дозвольте «Показувати поверх інших програм», щоб вікно було поверх інших застосунків.", "OK", "Скасувати", "Запустити бота", "Пауза бота", "Шаховий бот працює", "Увімкніть «Chess Auto Bot» у Спеціальних можливостях"},
    };

    private static final String PREFS = "chessbot";

    public static int current(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int i = p.getInt("lang", -1);
        if (i >= 0 && i < CODES.length) return i;
        Locale l = Locale.getDefault();
        String code = l.getLanguage();
        if (code.equals("zh") && ("TW".equals(l.getCountry()) || "HK".equals(l.getCountry()))) return 4;
        for (int k = 0; k < CODES.length; k++) if (CODES[k].equals(code)) return k;
        return 1;
    }

    public static void set(Context c, int idx) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt("lang", idx).apply();
    }

    public static String t(Context c, int key) { return S[current(c)][key]; }

    public static boolean rtl(Context c) { return current(c) == 11; }
}
