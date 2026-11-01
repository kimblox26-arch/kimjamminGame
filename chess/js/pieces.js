// 체스 기물·손 그림 (SVG, 100x100 좌표계)
// 같은 도형을 두 번 그린다: .o = 굵은 외곽선, .f = 입체 그라데이션 채움 → 바깥 윤곽선만 남는다
const pieceSVG = (() => {
  const base = '<rect x="22" y="76" width="56" height="14" rx="6"/>';
  const body = '<path d="M36 62C37 69 33 74 29 78H71C67 74 63 69 64 62Z"/>';

  const shapes = {
    p:
      '<path d="M34 78C36 66 41 58 42 52H58C59 58 64 66 66 78Z"/>' +
      '<circle class="s" cx="50" cy="33" r="15"/>' +
      '<rect x="34" y="47" width="32" height="9" rx="4.5"/>' + base,
    r:
      '<path d="M33 38H67L64 72H36Z"/>' +
      '<path d="M27 16H39V24H44V16H56V24H61V16H73V38H27Z"/>' +
      '<rect x="30" y="36" width="40" height="7" rx="3.5"/>' +
      '<rect x="30" y="68" width="40" height="9" rx="4.5"/>' + base,
    b:
      '<path d="M39 62C40 69 36 74 32 78H68C64 74 60 69 61 62Z"/>' +
      '<path d="M50 18C66 28 70 44 63 58H37C30 44 34 28 50 18Z"/>' +
      '<circle class="s" cx="50" cy="13" r="6"/>' +
      '<rect x="33" y="55" width="34" height="9" rx="4.5"/>' + base,
    n:
      '<path d="M30 78C30 66 36 58 44 52C38 54 32 57 27 58C21 59 17 54 19 48C21 43 26 39 30 34C33 27 37 22 41 18L42 10C45 12 48 15 50 17C66 18 77 32 76 52C75 63 72 71 70 78Z"/>' + base,
    q:
      body +
      '<path d="M31 60L22 30L37 46L39 24L46 43L50 19L54 43L61 24L63 46L78 30L69 60Z"/>' +
      '<circle class="s" cx="22" cy="30" r="5"/><circle class="s" cx="39" cy="24" r="5"/>' +
      '<circle class="s" cx="50" cy="18" r="5.5"/><circle class="s" cx="61" cy="24" r="5"/>' +
      '<circle class="s" cx="78" cy="30" r="5"/>' +
      '<rect x="29" y="57" width="42" height="9" rx="4.5"/>' + base,
    k:
      '<path d="M46 6H54V13H61V20H54V28H46V20H39V13H46Z"/>' +
      '<path d="M42 44C40 34 44 27 50 27C56 27 60 34 58 44Z"/>' +
      '<path d="M30 58C21 46 26 31 39 33C45 34 48 39 50 44C52 39 55 34 61 33C74 31 79 46 70 58Z"/>' +
      body +
      '<rect x="29" y="55" width="42" height="9" rx="4.5"/>' + base,
  };

  const details = {
    b: '<path class="ln" d="M56 30L46 42"/>',
    n: '<circle class="ey" cx="42" cy="31" r="3"/><circle class="ey" cx="23" cy="50" r="1.8"/>' +
       '<path class="ln soft" d="M55 23C64 29 69 40 69 54"/>',
    k: '<path class="ln soft" d="M50 44V55"/>',
  };

  return (type, color) =>
    `<svg class="pc ${color}" viewBox="0 0 100 100" aria-hidden="true">` +
    `<g class="o">${shapes[type]}</g><g class="f">${shapes[type]}</g>${details[type] || ''}</svg>`;
})();

const handSVG = (color) =>
  `<svg class="pc ${color}" viewBox="0 0 24 24" aria-hidden="true">` +
  '<g class="o"><circle cx="12" cy="12" r="8"/></g><g class="f"><circle class="s" cx="12" cy="12" r="8"/></g></svg>';
