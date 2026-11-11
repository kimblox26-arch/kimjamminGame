// 한 파일짜리 게임(HTML)을 만들어요. 사용: node tools/build-artifact.mjs [--full] [출력 경로]
// --full: 앱(APK)에 넣을 완전한 HTML 문서로 만들어요.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');
let js = '';
for (const m of ['data', 'art', 'engine', 'chart', 'app']) {
  let src = await read(`js/${m}.js`);
  const names = [];
  src = src.replace(/^export\s+(const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, n) => { names.push(n); return `${kw} ${n}`; });
  src = src.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+'\.\/(\w+)\.js';/gm, (_, ns, mod) => `const ${ns} = __m.${mod};`);
  src = src.replace(/^import\s+\{([^}]+)\}\s+from\s+'\.\/(\w+)\.js';/gm, (_, list, mod) => `const {${list}} = __m.${mod};`);
  if (/^\s*(import|export)\b/m.test(src)) throw new Error(`처리하지 못한 import/export: ${m}.js`);
  js += `__m.${m} = (() => {\n${src}\nreturn { ${names.map(n => `get ${n}() { return ${n}; }`).join(', ')} };\n})();\n`;
}
const args = process.argv.slice(2);
const full = args.includes('--full');
const html = await read('index.html');
const css = await read('css/style.css');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace('<script type="module" src="js/app.js"></script>', '');
const title = html.match(/<title>(.*?)<\/title>/)[1];
const out = full
  ? html.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>\n${css}\n</style>`)
      .replace('<script type="module" src="js/app.js"></script>', () => `<script type="module">\nconst __m = {};\n${js}</script>`)
  : `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="초등학생을 위한 주식 시뮬레이션 교육 게임">
<style>
${css}
</style>
${body.trim()}
<script type="module">
const __m = {};
${js}</script>
`;
const dest = args.find(a => !a.startsWith('--')) || fileURLToPath(new URL('dist/index.html', root));
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, out);
console.log('만들었어요:', dest, `(${(out.length / 1024).toFixed(0)} KB)`);
