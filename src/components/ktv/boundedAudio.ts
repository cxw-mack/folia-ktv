// Bounds streamed source audio before a Blob or decoder can allocate the full response.
export const KTV_MAX_INPUT_BYTES = 96 * 1024 * 1024;

export const readBoundedAudio = async (response: Response, limit = KTV_MAX_INPUT_BYTES): Promise<Blob | null> => {
    const declared = Number(response.headers.get('content-length'));
    if (!response.ok || declared > limit || !response.body) {
        await response.body?.cancel();
        return null;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) { await reader.cancel(); return null; }
            chunks.push(new Uint8Array(value));
        }
        return size ? new Blob(chunks, { type: response.headers.get('content-type') || '' }) : null;
    } finally { reader.releaseLock(); }
};
