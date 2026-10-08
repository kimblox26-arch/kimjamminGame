// 직접 그린 SVG 아이콘 — 이모지 대신 사용 (선 아이콘 + 감정 얼굴)

const P = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"/>',
  city: '<path d="M3 21V10l5-3v14M8 21V4l7 3v14M15 21V11l6 2v8M2 21h20"/><path d="M11 9v.01M11 12v.01M11 15v.01M18 15v.01M18 18v.01"/>',
  person: '<circle cx="12" cy="5" r="2.2"/><path d="M12 8.5v6.5M8 21l4-6 4 6M7.5 11.5l4.5-2 4.5 2"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor" stroke="none"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/><circle cx="12" cy="12" r="6.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  wave: '<path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M4 10c1-4 4-6.5 8-6.5 2.6 0 4.6 1 5.8 2.8-2.6-.4-4.8 1-5.3 3.4"/><path d="M2 19.5c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>',
  quake: '<path d="M2 12h4l2-5 3 10 3-12 3 9 2-2h3"/>',
  slide: '<path d="M3 20h18L14 7l-3 4-2-2z"/><path d="M15.5 14.5l3 1.5M12 15.5l2 3"/>',
  meteor: '<circle cx="16.5" cy="16.5" r="3.5"/><path d="M13.8 13.8L4 4M15 12.5L8.5 6M12.5 15L6 8.5"/>',
  height: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
  size: '<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  cube: '<path d="M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z"/><path d="M3.5 7.3L12 12l8.5-4.7M12 12v9.5"/>',
  run: '<circle cx="15" cy="4.5" r="2"/><path d="M5 21l4-5 3 2 1-5-4-2-3 3M13 13l4 2 3-1M9 7l3-1 4 3"/>',
  jump: '<path d="M12 20V6M6 12l6-6 6 6M5 21h14"/>',
  climb: '<path d="M7 21V3M17 21V3M7 7h10M7 12h10M7 17h10"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 010 6M18 6.5a8 8 0 010 11"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  reset: '<path d="M4 4v6h6"/><path d="M5.5 15a7.5 7.5 0 101.8-7.8L4 10"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7.3 4.3 4.3 0 0119.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor" stroke="none"/>',
  siren: '<path d="M6 18v-6a6 6 0 0112 0v6"/><path d="M4 21h16M12 2v2M4.2 5.2l1.4 1.4M19.8 5.2l-1.4 1.4"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  bolt: '<path d="M13 2L4.5 13.5H11L10 22l9-12h-6.5z"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
}

// 감정 얼굴: 피부톤 원 + 눈·눈썹·입을 감정별로 그림
const FACE = {
  calm: '<circle cx="9" cy="10.5" r="1.1"/><circle cx="15" cy="10.5" r="1.1"/><path d="M8.5 14.5c1.9 1.8 5.1 1.8 7 0" class="ln"/>',
  curious: '<circle cx="9.4" cy="10.8" r="1.1"/><circle cx="15.4" cy="10.8" r="1.1"/><path d="M7.5 7.8l3-.9M13.5 6.6l3 1" class="ln"/><circle cx="12.6" cy="15.6" r="1.3" class="ln"/>',
  confused: '<circle cx="9" cy="10.6" r="1.1"/><circle cx="15" cy="10.6" r="1.1"/><path d="M7.6 7.6l2.8.6M13.6 8.2l2.8-.8" class="ln"/><path d="M8.6 15.6c1.2-1.1 2.2 1 3.4 0s2.2 1 3.4 0" class="ln"/>',
  anxious: '<circle cx="9" cy="11" r="1.1"/><circle cx="15" cy="11" r="1.1"/><path d="M7.4 8.6l2.8-1.4M13.8 7.2l2.8 1.4" class="ln"/><path d="M9.2 15.6h5.6" class="ln"/>',
  fear: '<circle cx="9" cy="10.6" r="1.7" class="ln"/><circle cx="15" cy="10.6" r="1.7" class="ln"/><circle cx="9" cy="10.6" r=".6"/><circle cx="15" cy="10.6" r=".6"/><path d="M7.2 7.4l2.8-1.2M14 6.2l2.8 1.2" class="ln"/><ellipse cx="12" cy="16" rx="1.6" ry="2" class="ln"/>',
  panic: '<circle cx="9" cy="10.2" r="1.9" class="ln"/><circle cx="15" cy="10.2" r="1.9" class="ln"/><circle cx="9" cy="10.2" r=".55"/><circle cx="15" cy="10.2" r=".55"/><path d="M8.6 14.2h6.8c0 2.6-1.5 4-3.4 4s-3.4-1.4-3.4-4z" class="mouth"/><path d="M19 6.5c.9 1.4 1.3 2.4 0 3.2-1.3-.8-.9-1.8 0-3.2z" class="drop"/>',
  determined: '<circle cx="9" cy="11" r="1.1"/><circle cx="15" cy="11" r="1.1"/><path d="M7.2 7.6l3 1.4M16.8 7.6l-3 1.4" class="ln"/><path d="M9 15.4h6" class="ln"/>',
  frozen: '<circle cx="9" cy="10.6" r="1.6" class="ln"/><circle cx="15" cy="10.6" r="1.6" class="ln"/><path d="M9 15.6h6" class="ln"/>',
  struggle: '<circle cx="9" cy="9.2" r="1.6" class="ln"/><circle cx="15" cy="9.2" r="1.6" class="ln"/><ellipse cx="12" cy="13.4" rx="1.5" ry="1.4" class="ln"/><path d="M3 16.6c1.5 0 1.5-1.2 3-1.2s1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2V22H3z" class="sea"/>',
  relief: '<path d="M7.6 10.8c.8-1 2-1 2.8 0M13.6 10.8c.8-1 2-1 2.8 0" class="ln"/><path d="M9 14.6c1.6 1.4 4.4 1.4 6 0" class="ln"/><path d="M18.4 6c.8 1.2 1.1 2 0 2.7-1.1-.7-.8-1.5 0-2.7z" class="drop"/>',
  sad: '<circle cx="9" cy="11" r="1.1"/><circle cx="15" cy="11" r="1.1"/><path d="M7.4 8.4l2.8-1.2M13.8 7.2l2.8 1.2" class="ln"/><path d="M9 16.6c1.7-1.5 4.3-1.5 6 0" class="ln"/><path d="M8.6 13.2c.6.9.8 1.5 0 2-.8-.5-.6-1.1 0-2z" class="drop"/>',
};

export function face(emotion, color) {
  const f = FACE[emotion] || FACE.calm;
  return `<svg class="face" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${color}"/><circle cx="12" cy="12" r="10" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/><g class="feat">${f}</g></svg>`;
}
