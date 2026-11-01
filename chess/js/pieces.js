// 체스 기물 그림 (SVG, 100x100 좌표계)
const pieceSVG = (() => {
  const base = '<rect x="23" y="79" width="54" height="10" rx="3"/>';
  const body = '<path d="M36 64C36 71 32 76 28 79H72C68 76 64 71 64 64Z"/>';
  const balls =
    '<circle cx="24" cy="31" r="4"/><circle cx="38" cy="25" r="4"/><circle cx="50" cy="19" r="4.5"/>' +
    '<circle cx="62" cy="25" r="4"/><circle cx="76" cy="31" r="4"/>';

  const shapes = {
    p:
      '<path d="M39 46C39 58 34 68 30 79H70C66 68 61 58 61 46Z"/>' +
      '<rect x="35" y="40" width="30" height="7" rx="3.5"/>' +
      '<circle cx="50" cy="27" r="12"/>' + base,
    r:
      '<path d="M34 34H66L63 72H37Z"/>' +
      '<path d="M28 17H38V24H45V17H55V24H62V17H72V35H28Z"/>' +
      '<rect x="30" y="71" width="40" height="8" rx="2"/>' + base,
    b:
      '<circle cx="50" cy="15" r="5.5"/>' +
      '<path d="M50 21C63 31 67 45 62 57H38C33 45 37 31 50 21Z"/>' +
      '<path class="d" d="M55 33L47 43"/>' +
      '<path d="M40 61C40 69 35 75 31 79H69C65 75 60 69 60 61Z"/>' +
      '<rect x="34" y="55" width="32" height="7" rx="3.5"/>' + base,
    n:
      '<path d="M33 79C33 67 38 60 45 53L29 59C24 61 19 57 20 51C20 47 23 44 27 40L38 27L40 14L48 20C64 20 76 34 75 55C74 66 72 73 71 79Z"/>' +
      '<circle class="e" cx="41" cy="33" r="2.6"/>' +
      '<circle class="e" cx="25" cy="50" r="1.6"/>' + base,
    q:
      body +
      '<path d="M31 60L24 31L37 47L38 25L46 45L50 19L54 45L62 25L63 47L76 31L69 60Z"/>' +
      balls +
      '<rect x="29" y="58" width="42" height="7" rx="3.5"/>' + base,
    k:
      '<path d="M47 9H53V15H59V21H53V30H47V21H41V15H47Z"/>' +
      '<path d="M43 44C41 35 45 29 50 29C55 29 59 35 57 44Z"/>' +
      '<path d="M31 59C23 47 27 33 39 35C44 36 48 40 50 45C52 40 56 36 61 35C73 33 77 47 69 59Z"/>' +
      body +
      '<rect x="29" y="57" width="42" height="7" rx="3.5"/>' + base,
  };

  return (type, color) =>
    `<svg class="pc ${color}" viewBox="0 0 100 100" aria-hidden="true">${shapes[type]}</svg>`;
})();
