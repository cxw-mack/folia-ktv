import { describe, expect, it } from 'vitest';
import { readBoundedAudio } from '../../../src/components/ktv/boundedAudio';

// Prevents oversized or streaming responses from being fully buffered before the decoder limit applies.
describe('bounded audio download', () => {
    it('accepts an in-limit response without changing its content type', async () => {
        const response = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3', 'content-type': 'audio/mpeg' } });
        const blob = await readBoundedAudio(response, 3);
        expect(blob?.size).toBe(3);
        expect(blob?.type).toBe('audio/mpeg');
    });

    it('cancels a declared oversized response before reading its body', async () => {
        const response = new Response(new Uint8Array([1]), { headers: { 'content-length': '4096' } });
        expect(await readBoundedAudio(response, 3)).toBeNull();
        expect(response.bodyUsed).toBe(true);
    });

    it('cancels an oversized streamed response when the declared length is absent', async () => {
        const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close(); } });
        const response = new Response(stream);
        expect(await readBoundedAudio(response, 3)).toBeNull();
    });
});
