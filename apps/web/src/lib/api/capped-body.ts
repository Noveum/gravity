export async function readCappedBytes(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return null;
  const reader = request.body?.getReader();
  if (reader === undefined) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
