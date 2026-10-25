// 지형 격자(int16 리틀엔디언 원시값)를 받아온다.
// 보통은 data/<name>.bin.gz 를 쓰고, gzip 파일을 올릴 수 없는 호스트에서는 같은 내용을 base64 로 적은
// data/<name>.b64.txt 를 대신 읽는다. 호스트가 .gz 를 미리 풀어서 보내는 경우도 gzip 헤더(1f 8b)로 가려낸다.
export async function fetchElevation(name) {
  let bytes;
  const res = await fetch(`./data/${name}.bin.gz`);
  if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
  else {
    const b64 = await (await fetch(`./data/${name}.b64.txt`)).text();
    const bin = atob(b64.trim());
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.buffer;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
