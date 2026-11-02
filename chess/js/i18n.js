// 화면 글자 번역. KEYS 순서대로 각 언어의 문장을 적는다.
const I18N = (() => {
  const KEYS = ['title', 'subtitle', 'play', 'duo', 'settings', 'language', 'sound', 'hints', 'close', 'toMenu', 'menu',
    'think', 'speed', 'difficulty', 'easy', 'normal', 'hard', 'max', 'start', 'password', 'confirm', 'wrongPw', 'twoP',
    'checkmate', 'stalemate', 'insufficient', 'fifty', 'repetition', 'win', 'lose', 'draw', 'whiteWins', 'blackWins'];

  // [코드, 언어 이름, html lang, 문장들]
  const LANGS = [
    ['ko', '한국어', 'ko', ['체스', '컴퓨터와 한 판', '플레이', '두 명이서', '설정', '언어', '소리', '추천 표시', '닫기',
      '눌러서 메인으로', '메인', '생각 모드', '스피드 모드', '난이도', '쉬움', '보통', '어려움', '최강', '시작', '비밀번호', '확인',
      '비밀번호가 틀렸어요', '2인', '체크메이트', '스테일메이트', '기물 부족', '50수 규칙', '3회 동일 국면', '승리', '패배', '무승부',
      '백 승리', '흑 승리']],
    ['kp', '조선말', 'ko-KP', ['체스', '콤퓨터와 한판', '놀이하기', '두사람놀이', '설정', '언어', '소리', '수 추천', '닫기',
      '누르면 기본화면으로', '기본화면', '생각방식', '속도방식', '난도', '쉬움', '보통', '어려움', '최강', '시작', '암호', '확인',
      '암호가 틀립니다', '2인', '외통수', '수막힘', '말 부족', '50수 규칙', '3회 같은 국면', '승리', '패배', '비김',
      '백 승리', '흑 승리']],
    ['en', 'English', 'en', ['Chess', 'A game against the computer', 'Play', 'Two players', 'Settings', 'Language', 'Sound',
      'Move hints', 'Close', 'Tap to return to the menu', 'Menu', 'Think mode', 'Speed mode', 'Difficulty', 'Easy', 'Normal',
      'Hard', 'Max', 'Start', 'Password', 'OK', 'Wrong password', '2P', 'Checkmate', 'Stalemate', 'Insufficient material',
      '50-move rule', 'Threefold repetition', 'You win', 'You lose', 'Draw', 'White wins', 'Black wins']],
    ['ja', '日本語', 'ja', ['チェス', 'コンピューターと対局', 'プレイ', '二人で対戦', '設定', '言語', 'サウンド', 'おすすめ表示',
      '閉じる', 'タップしてメニューへ', 'メニュー', '熟考モード', 'スピードモード', '難易度', 'かんたん', 'ふつう', 'むずかしい', '最強',
      'スタート', 'パスワード', 'OK', 'パスワードが違います', '2人', 'チェックメイト', 'ステイルメイト', '駒不足', '50手ルール',
      '3回同一局面', '勝ち', '負け', '引き分け', '白の勝ち', '黒の勝ち']],
    ['zh', '中文', 'zh-CN', ['国际象棋', '与电脑对弈', '对局', '双人对战', '设置', '语言', '声音', '推荐提示', '关闭',
      '点击返回菜单', '菜单', '思考模式', '极速模式', '难度', '简单', '普通', '困难', '最强', '开始', '密码', '确定', '密码错误',
      '双人', '将杀', '逼和', '子力不足', '50回合规则', '三次重复局面', '你赢了', '你输了', '和棋', '白方胜', '黑方胜']],
    ['es', 'Español', 'es', ['Ajedrez', 'Una partida contra la computadora', 'Jugar', 'Dos jugadores', 'Ajustes', 'Idioma',
      'Sonido', 'Sugerencias', 'Cerrar', 'Toca para volver al menú', 'Menú', 'Modo pensar', 'Modo rápido', 'Dificultad', 'Fácil',
      'Normal', 'Difícil', 'Máximo', 'Empezar', 'Contraseña', 'Aceptar', 'Contraseña incorrecta', '2J', 'Jaque mate', 'Ahogado',
      'Material insuficiente', 'Regla de 50 movimientos', 'Triple repetición', 'Ganaste', 'Perdiste', 'Tablas',
      'Ganan las blancas', 'Ganan las negras']],
    ['fr', 'Français', 'fr', ['Échecs', 'Une partie contre l’ordinateur', 'Jouer', 'Deux joueurs', 'Réglages', 'Langue', 'Son',
      'Suggestions', 'Fermer', 'Touchez pour revenir au menu', 'Menu', 'Mode réflexion', 'Mode rapide', 'Difficulté', 'Facile',
      'Normal', 'Difficile', 'Maximum', 'Commencer', 'Mot de passe', 'OK', 'Mot de passe incorrect', '2J', 'Échec et mat', 'Pat',
      'Matériel insuffisant', 'Règle des 50 coups', 'Triple répétition', 'Vous gagnez', 'Vous perdez', 'Nulle',
      'Les Blancs gagnent', 'Les Noirs gagnent']],
    ['de', 'Deutsch', 'de', ['Schach', 'Eine Partie gegen den Computer', 'Spielen', 'Zwei Spieler', 'Einstellungen', 'Sprache',
      'Ton', 'Zugtipps', 'Schließen', 'Tippen, um zum Menü zurückzukehren', 'Menü', 'Denkmodus', 'Schnellmodus', 'Schwierigkeit',
      'Leicht', 'Normal', 'Schwer', 'Maximum', 'Start', 'Passwort', 'OK', 'Falsches Passwort', '2S', 'Schachmatt', 'Patt',
      'Ungenügendes Material', '50-Züge-Regel', 'Dreifache Wiederholung', 'Gewonnen', 'Verloren', 'Remis', 'Weiß gewinnt',
      'Schwarz gewinnt']],
    ['ru', 'Русский', 'ru', ['Шахматы', 'Партия с компьютером', 'Играть', 'Два игрока', 'Настройки', 'Язык', 'Звук', 'Подсказки',
      'Закрыть', 'Нажмите, чтобы вернуться в меню', 'Меню', 'Режим раздумий', 'Быстрый режим', 'Сложность', 'Легко', 'Средне',
      'Сложно', 'Максимум', 'Старт', 'Пароль', 'ОК', 'Неверный пароль', '2И', 'Мат', 'Пат', 'Недостаточно материала',
      'Правило 50 ходов', 'Троекратное повторение', 'Вы выиграли', 'Вы проиграли', 'Ничья', 'Белые победили', 'Чёрные победили']],
    ['pt', 'Português', 'pt', ['Xadrez', 'Uma partida contra o computador', 'Jogar', 'Dois jogadores', 'Configurações', 'Idioma',
      'Som', 'Dicas', 'Fechar', 'Toque para voltar ao menu', 'Menu', 'Modo pensar', 'Modo rápido', 'Dificuldade', 'Fácil', 'Normal',
      'Difícil', 'Máximo', 'Começar', 'Senha', 'OK', 'Senha incorreta', '2J', 'Xeque-mate', 'Afogamento', 'Material insuficiente',
      'Regra dos 50 lances', 'Tripla repetição', 'Você venceu', 'Você perdeu', 'Empate', 'Brancas vencem', 'Pretas vencem']],
    ['vi', 'Tiếng Việt', 'vi', ['Cờ vua', 'Đấu với máy tính', 'Chơi', 'Hai người chơi', 'Cài đặt', 'Ngôn ngữ', 'Âm thanh',
      'Gợi ý nước đi', 'Đóng', 'Chạm để về menu', 'Menu', 'Chế độ suy nghĩ', 'Chế độ tốc độ', 'Độ khó', 'Dễ', 'Thường', 'Khó',
      'Mạnh nhất', 'Bắt đầu', 'Mật khẩu', 'OK', 'Sai mật khẩu', '2N', 'Chiếu hết', 'Hết nước đi', 'Không đủ quân', 'Luật 50 nước',
      'Lặp lại 3 lần', 'Bạn thắng', 'Bạn thua', 'Hòa', 'Trắng thắng', 'Đen thắng']],
  ];

  const TEXT = {}, htmlLang = {}, names = [];
  for (const [code, name, html, words] of LANGS) {
    TEXT[code] = Object.fromEntries(KEYS.map((k, i) => [k, words[i]]));
    htmlLang[code] = html;
    names.push([code, name]);
  }
  return { TEXT, htmlLang, names };
})();
