// 화면 전환 레지스트리 (모듈 간 순환 참조 방지)
export const screens = {};
export const app = { loading: true, newsShown: false, inRoom: false };
export function go(name, ...args) { return screens[name](...args); }
