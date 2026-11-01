// 체스 기물 그림 (SVG, 100x100 좌표계)
// 같은 도형을 두 번 그린다: .o = 외곽선, .f = 입체 그라데이션 채움 → 바깥 윤곽선만 남는다
const pieceSVG = (() => {
  const base = '<rect x="24" y="74" width="52" height="12" rx="4"/>';
  const body = '<path d="M36 63C36 69 33 73 29 75H71C67 73 64 69 64 63Z"/>';

  const shapes = {
    p:
      '<path d="M41 47C41 59 36 69 30 75H70C64 69 59 59 59 47Z"/>' +
      '<circle class="s" cx="50" cy="31" r="12"/>' +
      '<rect x="37" y="42" width="26" height="7" rx="3.5"/>' + base,
    r:
      '<path d="M35 36H65L62 70H38Z"/>' +
      '<path d="M29 19H39V26H45V19H55V26H61V19H71V38H29Z"/>' +
      '<rect x="27" y="67" width="46" height="8" rx="3"/>' + base,
    b:
      '<path d="M41 63C41 69 37 73 33 75H67C63 73 59 69 59 63Z"/>' +
      '<path d="M50 15C56 19 62 25 64.5 31L52 42L55 45L67 37C69 45 66 54 61 60H39C33 52 32 42 36 33C40 25 45 19 50 15Z"/>' +
      '<circle class="s" cx="50" cy="12" r="4.5"/>' +
      '<rect x="36" y="57" width="28" height="7" rx="3.5"/>' + base,
    n:
      '<path d="M30 75C30 66 34 60 42 54C36 55 30 57 26 58C20 59 17 54 19 49C21 44 25 41 29 37C33 31 37 26 42 21L44 13C47 15 50 17 52 19C66 21 76 34 75 52C74 62 72 69 71 75Z"/>' + base,
    q:
      body +
      '<path d="M32 60L24 31L38 46L37 23L46 42L50 19L54 42L63 23L62 46L76 31L68 60Z"/>' +
      '<circle class="s" cx="24" cy="30" r="4.5"/><circle class="s" cx="37" cy="22" r="4.5"/>' +
      '<circle class="s" cx="50" cy="18" r="5"/><circle class="s" cx="63" cy="22" r="4.5"/>' +
      '<circle class="s" cx="76" cy="30" r="4.5"/>' +
      '<rect x="30" y="57" width="40" height="8" rx="4"/>' + base,
    k:
      '<path d="M47 8H53V14H59V20H53V27H47V20H41V14H47Z"/>' +
      '<path d="M43 43C41 34 45 28 50 28C55 28 59 34 57 43Z"/>' +
      '<path d="M30 58C22 46 26 32 39 33C44 33 48 37 50 42C52 37 56 33 61 33C74 32 78 46 70 58Z"/>' +
      body +
      '<rect x="30" y="55" width="40" height="8" rx="4"/>' + base,
  };

  const details = {
    n: '<circle class="ey" cx="41" cy="31" r="3"/>',
  };

  return (type, color) =>
    `<svg class="pc ${color}" viewBox="0 0 100 100" aria-hidden="true">` +
    `<g class="o">${shapes[type]}</g><g class="f">${shapes[type]}</g>${details[type] || ''}</svg>`;
})();
