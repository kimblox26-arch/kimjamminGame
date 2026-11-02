// 체스 기물 그림 (SVG, 100x100 좌표계) — 평면 채색 + 얇은 외곽선
// 같은 도형을 두 번 그린다: .o = 외곽선, .f = 채움 → 바깥 윤곽선만 남는다
const pieceSVG = (() => {
  const bowl = (y) => `<path d="M31 ${y}H69C70 ${y + 8} 71 ${y + 13} 74 ${y + 17}H26C29 ${y + 13} 30 ${y + 8} 31 ${y}Z"/>`;

  const shapes = {
    p:
      '<path d="M40 50C40 60 34 68 28 74H72C66 68 60 60 60 50Z"/>' +
      '<circle cx="50" cy="33" r="13"/>' +
      '<rect x="38" y="45" width="24" height="7" rx="3.5"/>' +
      '<rect x="24" y="72" width="52" height="12" rx="3"/>',
    r:
      '<path d="M35 34H65L63 66H37Z"/>' +
      '<path d="M29 17H38V24H45V17H55V24H62V17H71V33C68 35 66 36 65 37H35C34 36 32 35 29 33Z"/>' +
      '<path d="M36 63H64C65 67 68 70 72 72H28C32 70 35 67 36 63Z"/>' +
      '<rect x="24" y="71" width="52" height="13" rx="3"/>',
    b:
      '<path d="M40 61C40 67 36 71 31 74H69C64 71 60 67 60 61Z"/>' +
      '<path d="M50 14C64 24 68 42 62 57H38C32 42 36 24 50 14Z"/>' +
      '<circle cx="50" cy="12" r="4.5"/>' +
      '<rect x="35" y="55" width="30" height="7" rx="3.5"/>' +
      '<rect x="24" y="72" width="52" height="12" rx="3"/>',
    n:
      '<path d="M29 74C29 65 33 59 41 53C35 54 30 56 26 57C20 58 16 53 18 48C20 43 24 40 28 36C32 30 36 25 41 20L43 12C46 14 49 16 51 18C66 20 77 33 76 51C75 61 73 68 72 74Z"/>' +
      '<rect x="24" y="72" width="52" height="12" rx="3"/>',
    q:
      '<path d="M33 62C30 51 26 42 19 34L35 46L37 26L46 44L50 22L54 44L63 26L65 46L81 34C74 42 70 51 67 62Z"/>' +
      '<circle cx="19" cy="32" r="5.5"/><circle cx="37" cy="24" r="5.5"/><circle cx="50" cy="19" r="6"/>' +
      '<circle cx="63" cy="24" r="5.5"/><circle cx="81" cy="32" r="5.5"/>' +
      bowl(59) + '<rect x="23" y="74" width="54" height="10" rx="3"/>',
    k:
      '<path d="M46 7H54V13H60V20H54V27H46V20H40V13H46Z"/>' +
      '<path d="M43 44C41 35 45 28 50 28C55 28 59 35 57 44Z"/>' +
      '<path d="M30 59C20 47 25 31 39 33C45 34 48 39 50 44C52 39 55 34 61 33C75 31 80 47 70 59Z"/>' +
      bowl(57) + '<rect x="23" y="72" width="54" height="12" rx="3"/>',
  };

  const details = {
    b: '<path class="ln" d="M54 24L48.5 40"/>',
    n: '<circle class="ey" cx="40" cy="31" r="3"/><path class="ln soft" d="M54 22C65 28 70 40 70 54"/>',
    k: '<path class="ln soft" d="M50 44V56"/>',
  };

  return (type, color) =>
    `<svg class="pc ${color}" viewBox="0 0 100 100" aria-hidden="true">` +
    `<g class="o">${shapes[type]}</g><g class="f">${shapes[type]}</g>${details[type] || ''}</svg>`;
})();
