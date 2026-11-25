/** Enforce the byte limit while reading, including responses without Content-Length. */
export async function boundedResponseText(response: Response, maxBytes: number, message: string): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    const advertised = response.headers.get('content-length');
    if (advertised !== null && Number(advertised) > maxBytes) throw new Error(message);
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes) throw new Error(message);
      text += decoder.decode(result.value, {stream: true});
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
