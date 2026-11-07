package com.kimjammin.chessbot;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Locale;

/** 다국어 문자열 (20개 언어) */
public final class I18n {
    public static final int SUBTITLE = 0, START = 1, STOP = 2, ST_IDLE = 3, ST_RUN = 4, HINT = 5, F_FAST = 6,
            F_BRAIN = 7, F_AUTO = 8, LANG = 9, PERM_TITLE = 10, PERM_MSG = 11, OK = 12, CANCEL = 13, BOT_ON = 14,
            BOT_OFF = 15, NEW_GAME = 16, FLIP = 17, OPP_HUMAN = 18, OPP_AI = 19, THINKING = 20, YOUR_MOVE = 21,
            BOT_WIN = 22, BOT_LOSE = 23, DRAW = 24, OPP = 25, AGGR = 26, DEFN = 27, BAL = 28, LEARNING = 29,
            PREDICT = 30, EXPLOIT = 31, NOTIF = 32, ACCURACY = 33, RECORD = 34;

    public static final String[] CODES = {"ko", "en", "ja", "zh", "zh-TW", "es", "fr", "de", "it", "pt", "ru",
            "ar", "hi", "id", "vi", "th", "tr", "pl", "nl", "uk"};
    public static final String[] NAMES = {"한국어", "English", "日本語", "简体中文", "繁體中文", "Español", "Français",
            "Deutsch", "Italiano", "Português", "Русский", "العربية", "हिन्दी", "Bahasa Indonesia", "Tiếng Việt",
            "ไทย", "Türkçe", "Polski", "Nederlands", "Українська"};

    private static final String[][] S = {
            {"AI 체스 봇 · 초고속 탐색 · 패턴 학습", "봇 시작하기", "멈추기", "대기 중", "실행 중", "창을 닫으면 체스 버튼으로 작아집니다. 버튼을 누르면 다시 열려요.",
                    "초고속 탐색", "패턴 분석", "자동 플레이", "언어", "권한 필요", "다른 앱 위에 창을 띄우려면 '다른 앱 위에 표시' 권한을 허용해 주세요.", "확인", "취소",
                    "봇 작동하기", "봇 정지", "새 게임", "색 바꾸기", "상대: 사람", "상대: AI", "생각 중", "당신 차례", "봇 승리!", "봇 패배", "무승부",
                    "상대 분석", "공격형", "수비형", "균형형", "학습 중", "예상 수", "패턴 공략!", "체스 봇 실행 중", "적중률", "전적"},
            {"AI Chess Bot · Lightning search · Pattern learning", "Start Bot", "Stop", "Idle", "Running", "Close the window to shrink it into a chess button. Tap the button to open it again.",
                    "Lightning search", "Pattern analysis", "Auto play", "Language", "Permission needed", "Allow 'Display over other apps' so the window can float above other apps.", "OK", "Cancel",
                    "Run Bot", "Pause Bot", "New game", "Switch color", "Opponent: Human", "Opponent: AI", "Thinking", "Your move", "Bot wins!", "Bot lost", "Draw",
                    "Opponent", "Aggressive", "Defensive", "Balanced", "Learning", "Predicted", "Pattern exploit!", "Chess bot is running", "Accuracy", "Record"},
            {"AIチェスボット・超高速探索・パターン学習", "ボット開始", "停止", "待機中", "実行中", "ウィンドウを閉じるとチェスボタンに縮小されます。タップすると再び開きます。",
                    "超高速探索", "パターン分析", "自動プレイ", "言語", "権限が必要です", "他のアプリの上にウィンドウを表示するため「他のアプリの上に重ねて表示」を許可してください。", "OK", "キャンセル",
                    "ボット作動", "ボット停止", "新しいゲーム", "色を交代", "相手: 人間", "相手: AI", "思考中", "あなたの番", "ボットの勝ち!", "ボットの負け", "引き分け",
                    "相手分析", "攻撃型", "守備型", "バランス型", "学習中", "予想手", "パターン攻略!", "チェスボット実行中", "的中率", "戦績"},
            {"AI国际象棋机器人 · 极速搜索 · 模式学习", "启动机器人", "停止", "待机", "运行中", "关闭窗口后会缩小为象棋按钮，点击按钮即可重新打开。",
                    "极速搜索", "模式分析", "自动对弈", "语言", "需要权限", "请允许“显示在其他应用上层”，以便窗口悬浮在其他应用之上。", "确定", "取消",
                    "运行机器人", "暂停机器人", "新游戏", "交换颜色", "对手: 人类", "对手: AI", "思考中", "轮到你", "机器人获胜!", "机器人失败", "和棋",
                    "对手分析", "进攻型", "防守型", "均衡型", "学习中", "预测着法", "模式克制!", "象棋机器人运行中", "命中率", "战绩"},
            {"AI西洋棋機器人 · 極速搜尋 · 模式學習", "啟動機器人", "停止", "待機", "執行中", "關閉視窗後會縮小為棋子按鈕，點擊按鈕即可重新開啟。",
                    "極速搜尋", "模式分析", "自動對弈", "語言", "需要權限", "請允許「顯示在其他應用程式上層」，讓視窗浮在其他應用程式之上。", "確定", "取消",
                    "執行機器人", "暫停機器人", "新遊戲", "交換顏色", "對手: 人類", "對手: AI", "思考中", "輪到你", "機器人獲勝!", "機器人落敗", "和棋",
                    "對手分析", "進攻型", "防守型", "均衡型", "學習中", "預測著法", "模式剋制!", "西洋棋機器人執行中", "命中率", "戰績"},
            {"Bot de ajedrez IA · Búsqueda ultrarrápida · Aprende patrones", "Iniciar bot", "Detener", "En espera", "En marcha", "Cierra la ventana para reducirla a un botón de ajedrez. Tócalo para abrirla de nuevo.",
                    "Búsqueda ultrarrápida", "Análisis de patrones", "Juego automático", "Idioma", "Permiso necesario", "Permite 'Mostrar sobre otras apps' para que la ventana flote sobre otras aplicaciones.", "Aceptar", "Cancelar",
                    "Activar bot", "Pausar bot", "Nueva partida", "Cambiar color", "Rival: Humano", "Rival: IA", "Pensando", "Tu turno", "¡Gana el bot!", "El bot perdió", "Tablas",
                    "Rival", "Agresivo", "Defensivo", "Equilibrado", "Aprendiendo", "Previsto", "¡Patrón explotado!", "El bot de ajedrez está activo", "Precisión", "Récord"},
            {"Bot d'échecs IA · Recherche ultra-rapide · Apprentissage", "Démarrer le bot", "Arrêter", "En attente", "En cours", "Fermez la fenêtre pour la réduire en bouton d'échecs. Touchez-le pour la rouvrir.",
                    "Recherche ultra-rapide", "Analyse des habitudes", "Jeu automatique", "Langue", "Autorisation requise", "Autorisez « Afficher par-dessus les autres applis » pour que la fenêtre flotte.", "OK", "Annuler",
                    "Lancer le bot", "Pause du bot", "Nouvelle partie", "Changer de couleur", "Adversaire : Humain", "Adversaire : IA", "Réflexion", "À vous", "Le bot gagne !", "Le bot a perdu", "Nulle",
                    "Adversaire", "Agressif", "Défensif", "Équilibré", "Apprentissage", "Prévu", "Habitude exploitée !", "Le bot d'échecs est actif", "Précision", "Bilan"},
            {"KI-Schachbot · Blitzschnelle Suche · Mustererkennung", "Bot starten", "Stopp", "Bereit", "Läuft", "Schließe das Fenster, um es zu einem Schach-Button zu verkleinern. Tippe darauf, um es wieder zu öffnen.",
                    "Blitzschnelle Suche", "Musteranalyse", "Autospiel", "Sprache", "Berechtigung nötig", "Erlaube „Über anderen Apps einblenden“, damit das Fenster über anderen Apps schwebt.", "OK", "Abbrechen",
                    "Bot aktivieren", "Bot pausieren", "Neues Spiel", "Farbe wechseln", "Gegner: Mensch", "Gegner: KI", "Denkt nach", "Du bist dran", "Bot gewinnt!", "Bot verliert", "Remis",
                    "Gegner", "Aggressiv", "Defensiv", "Ausgewogen", "Lernt", "Erwartet", "Muster ausgenutzt!", "Schachbot läuft", "Trefferquote", "Bilanz"},
            {"Bot di scacchi IA · Ricerca fulminea · Apprende gli schemi", "Avvia bot", "Ferma", "In attesa", "In esecuzione", "Chiudi la finestra per ridurla a un pulsante. Toccalo per riaprirla.",
                    "Ricerca fulminea", "Analisi schemi", "Gioco automatico", "Lingua", "Permesso richiesto", "Consenti 'Mostra sopra altre app' per far fluttuare la finestra sopra le altre app.", "OK", "Annulla",
                    "Attiva bot", "Pausa bot", "Nuova partita", "Cambia colore", "Avversario: Umano", "Avversario: IA", "Sto pensando", "Tocca a te", "Il bot vince!", "Il bot ha perso", "Patta",
                    "Avversario", "Aggressivo", "Difensivo", "Equilibrato", "Apprendimento", "Previsto", "Schema sfruttato!", "Il bot di scacchi è attivo", "Precisione", "Record"},
            {"Bot de xadrez IA · Busca ultrarrápida · Aprende padrões", "Iniciar bot", "Parar", "Em espera", "Em execução", "Feche a janela para reduzi-la a um botão de xadrez. Toque nele para abrir de novo.",
                    "Busca ultrarrápida", "Análise de padrões", "Jogo automático", "Idioma", "Permissão necessária", "Permita 'Sobrepor a outros apps' para a janela flutuar sobre outros aplicativos.", "OK", "Cancelar",
                    "Ativar bot", "Pausar bot", "Novo jogo", "Trocar cor", "Rival: Humano", "Rival: IA", "Pensando", "Sua vez", "Bot venceu!", "Bot perdeu", "Empate",
                    "Rival", "Agressivo", "Defensivo", "Equilibrado", "Aprendendo", "Previsto", "Padrão explorado!", "O bot de xadrez está ativo", "Precisão", "Placar"},
            {"Шахматный ИИ-бот · Молниеносный поиск · Изучает стиль", "Запустить бота", "Стоп", "Ожидание", "Работает", "Закройте окно, чтобы свернуть его в шахматную кнопку. Нажмите её, чтобы открыть снова.",
                    "Молниеносный поиск", "Анализ стиля", "Автоигра", "Язык", "Нужно разрешение", "Разрешите «Поверх других приложений», чтобы окно отображалось поверх других программ.", "ОК", "Отмена",
                    "Запустить бота", "Пауза бота", "Новая игра", "Сменить цвет", "Соперник: человек", "Соперник: ИИ", "Думаю", "Ваш ход", "Бот победил!", "Бот проиграл", "Ничья",
                    "Соперник", "Атакующий", "Защитный", "Сбалансированный", "Обучение", "Прогноз", "Слабость найдена!", "Шахматный бот работает", "Точность", "Счёт"},
            {"روبوت شطرنج ذكي · بحث فائق السرعة · تعلّم الأنماط", "تشغيل الروبوت", "إيقاف", "في الانتظار", "قيد التشغيل", "أغلق النافذة لتصغيرها إلى زر شطرنج، واضغط الزر لفتحها مجددًا.",
                    "بحث فائق السرعة", "تحليل الأنماط", "لعب تلقائي", "اللغة", "مطلوب إذن", "اسمح بـ«الظهور فوق التطبيقات الأخرى» لكي تطفو النافذة فوقها.", "موافق", "إلغاء",
                    "تشغيل الروبوت", "إيقاف مؤقت", "لعبة جديدة", "تبديل اللون", "الخصم: إنسان", "الخصم: ذكاء اصطناعي", "يفكر", "دورك", "فاز الروبوت!", "خسر الروبوت", "تعادل",
                    "تحليل الخصم", "هجومي", "دفاعي", "متوازن", "يتعلم", "النقلة المتوقعة", "تم استغلال النمط!", "روبوت الشطرنج يعمل", "الدقة", "السجل"},
            {"एआई शतरंज बॉट · तेज़ खोज · पैटर्न सीखना", "बॉट शुरू करें", "रोकें", "प्रतीक्षा", "चल रहा है", "विंडो बंद करने पर यह शतरंज बटन बन जाती है। बटन दबाकर फिर खोलें।",
                    "तेज़ खोज", "पैटर्न विश्लेषण", "ऑटो खेल", "भाषा", "अनुमति चाहिए", "विंडो को दूसरे ऐप्स के ऊपर दिखाने के लिए 'अन्य ऐप्स पर दिखाएँ' की अनुमति दें।", "ठीक है", "रद्द करें",
                    "बॉट चलाएँ", "बॉट रोकें", "नया खेल", "रंग बदलें", "विरोधी: इंसान", "विरोधी: एआई", "सोच रहा है", "आपकी चाल", "बॉट जीता!", "बॉट हारा", "ड्रॉ",
                    "विरोधी विश्लेषण", "आक्रामक", "रक्षात्मक", "संतुलित", "सीख रहा है", "अनुमानित चाल", "पैटर्न का फायदा!", "शतरंज बॉट चल रहा है", "सटीकता", "रिकॉर्ड"},
            {"Bot Catur AI · Pencarian kilat · Belajar pola", "Mulai Bot", "Berhenti", "Siaga", "Berjalan", "Tutup jendela untuk mengecilkannya menjadi tombol catur. Ketuk tombol untuk membukanya lagi.",
                    "Pencarian kilat", "Analisis pola", "Main otomatis", "Bahasa", "Izin diperlukan", "Izinkan 'Tampilkan di atas aplikasi lain' agar jendela melayang di atas aplikasi lain.", "OK", "Batal",
                    "Jalankan Bot", "Jeda Bot", "Permainan baru", "Tukar warna", "Lawan: Manusia", "Lawan: AI", "Berpikir", "Giliranmu", "Bot menang!", "Bot kalah", "Remis",
                    "Analisis lawan", "Agresif", "Defensif", "Seimbang", "Belajar", "Prediksi", "Pola dimanfaatkan!", "Bot catur sedang berjalan", "Akurasi", "Rekor"},
            {"Bot cờ vua AI · Tìm kiếm siêu tốc · Học thói quen", "Bật bot", "Dừng", "Chờ", "Đang chạy", "Đóng cửa sổ để thu nhỏ thành nút cờ vua. Chạm vào nút để mở lại.",
                    "Tìm kiếm siêu tốc", "Phân tích thói quen", "Tự động chơi", "Ngôn ngữ", "Cần cấp quyền", "Hãy cho phép 'Hiển thị trên ứng dụng khác' để cửa sổ nổi trên các ứng dụng khác.", "OK", "Hủy",
                    "Chạy bot", "Tạm dừng bot", "Ván mới", "Đổi màu", "Đối thủ: Người", "Đối thủ: AI", "Đang nghĩ", "Lượt bạn", "Bot thắng!", "Bot thua", "Hòa",
                    "Phân tích đối thủ", "Tấn công", "Phòng thủ", "Cân bằng", "Đang học", "Dự đoán", "Khai thác thói quen!", "Bot cờ vua đang chạy", "Độ chính xác", "Thành tích"},
            {"บอทหมากรุก AI · ค้นหาเร็วสุด · เรียนรู้รูปแบบ", "เริ่มบอท", "หยุด", "รอ", "กำลังทำงาน", "ปิดหน้าต่างเพื่อย่อเป็นปุ่มหมากรุก แตะปุ่มเพื่อเปิดอีกครั้ง",
                    "ค้นหาเร็วสุด", "วิเคราะห์รูปแบบ", "เล่นอัตโนมัติ", "ภาษา", "ต้องการสิทธิ์", "โปรดอนุญาต 'แสดงทับแอปอื่น' เพื่อให้หน้าต่างลอยอยู่เหนือแอปอื่น", "ตกลง", "ยกเลิก",
                    "เปิดบอท", "พักบอท", "เกมใหม่", "สลับสี", "คู่แข่ง: คน", "คู่แข่ง: AI", "กำลังคิด", "ตาคุณ", "บอทชนะ!", "บอทแพ้", "เสมอ",
                    "วิเคราะห์คู่แข่ง", "รุก", "รับ", "สมดุล", "กำลังเรียนรู้", "ตาที่คาด", "เจาะจุดอ่อนสำเร็จ!", "บอทหมากรุกกำลังทำงาน", "ความแม่นยำ", "สถิติ"},
            {"Yapay zekâ satranç botu · Işık hızında arama · Örüntü öğrenme", "Botu başlat", "Durdur", "Beklemede", "Çalışıyor", "Pencereyi kapatınca satranç düğmesine küçülür. Tekrar açmak için düğmeye dokun.",
                    "Işık hızında arama", "Örüntü analizi", "Otomatik oyun", "Dil", "İzin gerekli", "Pencerenin diğer uygulamaların üstünde durması için 'Diğer uygulamaların üzerinde göster' iznini ver.", "Tamam", "İptal",
                    "Botu çalıştır", "Botu duraklat", "Yeni oyun", "Renk değiştir", "Rakip: İnsan", "Rakip: YZ", "Düşünüyor", "Sıra sende", "Bot kazandı!", "Bot kaybetti", "Berabere",
                    "Rakip analizi", "Saldırgan", "Savunmacı", "Dengeli", "Öğreniyor", "Tahmin", "Örüntü yakalandı!", "Satranç botu çalışıyor", "İsabet", "Skor"},
            {"Szachowy bot AI · Błyskawiczne liczenie · Uczy się nawyków", "Uruchom bota", "Zatrzymaj", "Bezczynny", "Działa", "Zamknij okno, aby zmniejszyć je do przycisku szachowego. Dotknij go, aby otworzyć ponownie.",
                    "Błyskawiczne liczenie", "Analiza nawyków", "Autogra", "Język", "Wymagane uprawnienie", "Zezwól na „Wyświetlanie nad innymi aplikacjami”, aby okno unosiło się nad innymi aplikacjami.", "OK", "Anuluj",
                    "Włącz bota", "Wstrzymaj bota", "Nowa gra", "Zmień kolor", "Rywal: człowiek", "Rywal: AI", "Myśli", "Twój ruch", "Bot wygrał!", "Bot przegrał", "Remis",
                    "Analiza rywala", "Agresywny", "Defensywny", "Zrównoważony", "Uczy się", "Przewidywany", "Nawyk wykorzystany!", "Bot szachowy działa", "Trafność", "Bilans"},
            {"AI-schaakbot · Bliksemsnel rekenen · Leert patronen", "Bot starten", "Stoppen", "Inactief", "Actief", "Sluit het venster om het te verkleinen tot een schaakknop. Tik erop om het weer te openen.",
                    "Bliksemsnel rekenen", "Patroonanalyse", "Automatisch spelen", "Taal", "Toestemming nodig", "Sta 'Weergeven boven andere apps' toe zodat het venster boven andere apps zweeft.", "OK", "Annuleren",
                    "Bot activeren", "Bot pauzeren", "Nieuw spel", "Kleur wisselen", "Tegenstander: mens", "Tegenstander: AI", "Denkt na", "Jouw zet", "Bot wint!", "Bot verliest", "Remise",
                    "Tegenstander", "Aanvallend", "Verdedigend", "Gebalanceerd", "Leert", "Verwacht", "Patroon benut!", "Schaakbot is actief", "Nauwkeurigheid", "Score"},
            {"Шаховий ШІ-бот · Блискавичний пошук · Вивчає стиль", "Запустити бота", "Стоп", "Очікування", "Працює", "Закрийте вікно, щоб згорнути його в шахову кнопку. Натисніть її, щоб відкрити знову.",
                    "Блискавичний пошук", "Аналіз стилю", "Автогра", "Мова", "Потрібен дозвіл", "Дозвольте «Показувати поверх інших програм», щоб вікно було поверх інших застосунків.", "OK", "Скасувати",
                    "Запустити бота", "Пауза бота", "Нова гра", "Змінити колір", "Суперник: людина", "Суперник: ШІ", "Думаю", "Ваш хід", "Бот переміг!", "Бот програв", "Нічия",
                    "Суперник", "Атакуючий", "Захисний", "Збалансований", "Навчання", "Прогноз", "Слабкість знайдено!", "Шаховий бот працює", "Точність", "Рахунок"},
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
