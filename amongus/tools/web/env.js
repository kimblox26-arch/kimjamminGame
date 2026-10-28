// 브라우저판: 서버 코드가 읽는 process.env 흉내 (rooms.js 보다 먼저 불러야 함)
globalThis.process ||= { env: {} };
process.env.MIN_PLAYERS ??= '4';
