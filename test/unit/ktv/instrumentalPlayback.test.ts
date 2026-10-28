import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutomixDeckChain } from '../../../src/services/automix/crossfadeGraph';
import { createInstrumentalPlayback } from '../../../src/components/ktv/instrumentalPlayback';
import { KTV_SAMPLE_RATE, KTV_TILE_SAMPLES } from '../../../src/components/ktv/instrumentalPlan';
import type { InstrumentalTrack } from '../../../src/components/ktv/instrumentalTrack';
import type { KtvAudioMode } from '../../../src/types/ktv';

// Runs the real clock scheduler against a small Web Audio recorder for alignment and fallback behavior.
const makeParam = () => ({ value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
const makeChain = () => ({ ktvOriginal: { gain: makeParam() }, ktvInstrumental: { gain: makeParam() } }) as unknown as AutomixDeckChain;
const makeTrack = (ready: number[], total: number) => ({
    total, ready: new Set(ready),
    tiles: new Map(ready.map(index => [index, [new Int16Array(Math.min(KTV_TILE_SAMPLES, total - index * KTV_TILE_SAMPLES)), new Int16Array(Math.min(KTV_TILE_SAMPLES, total - index * KTV_TILE_SAMPLES))] as [Int16Array, Int16Array]])),
}) as InstrumentalTrack;
const makeHarness = (track: InstrumentalTrack, position = 0.4, rate = 1) => {
    const handlers = new Map<string, () => void>();
    const audio = {
        currentTime: position, playbackRate: rate, paused: false, ended: false, seeking: false, readyState: 4,
        addEventListener: vi.fn((event: string, listener: () => void) => handlers.set(event, listener)),
        removeEventListener: vi.fn((event: string) => handlers.delete(event)),
    } as unknown as HTMLAudioElement;
    const sources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const context = {
        currentTime: 1, state: 'running',
        createBuffer: (_channels: number, length: number, rate: number) => {
            const channels = [new Float32Array(length), new Float32Array(length)];
            return { duration: length / rate, getChannelData: (channel: number) => channels[channel] } as unknown as AudioBuffer;
        },
        createBufferSource: () => {
            const source = { buffer: null, playbackRate: { value: 1 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null };
            sources.push(source);
            return source as unknown as AudioBufferSourceNode;
        },
    } as unknown as AudioContext;
    const chain = makeChain();
    const modes: KtvAudioMode[] = [];
    const release = createInstrumentalPlayback({ audio, context, chain, track: () => track, mode: () => 'instrumental', onAudible: mode => modes.push(mode) });
    return { audio, context, chain, handlers, sources, modes, release };
};

afterEach(() => vi.useRealTimers());

describe('instrumental playback clock', () => {
    it('schedules ready PCM on the media clock and fades back at the next gap', () => {
        const harness = makeHarness(makeTrack([0, 2], KTV_TILE_SAMPLES * 3));
        expect(harness.sources).toHaveLength(1);
        expect(harness.sources[0].start).toHaveBeenCalledWith(expect.any(Number), expect.closeTo(0.412, 3));
        expect(harness.modes.at(-1)).toBe('instrumental');
        expect(harness.chain.ktvOriginal.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
        harness.release();
        expect(harness.sources[0].stop).toHaveBeenCalledOnce();
        expect(harness.modes.at(-1)).toBe('original');
    });

    it('keeps original audio audible when the playhead has no accompaniment or runs at a different rate', () => {
        const absent = makeHarness(makeTrack([], KTV_TILE_SAMPLES));
        expect(absent.sources).toHaveLength(0);
        expect(absent.modes.at(-1)).toBe('original');
        absent.release();
        const changedRate = makeHarness(makeTrack([0], KTV_TILE_SAMPLES), 0.4, 1.25);
        expect(changedRate.sources).toHaveLength(0);
        expect(changedRate.modes.at(-1)).toBe('original');
        changedRate.release();
    });

    it('stops the accompaniment on a seek and schedules the segment at the new position', () => {
        const harness = makeHarness(makeTrack([0, 2], KTV_TILE_SAMPLES * 3));
        const first = harness.sources[0];
        (harness.audio as unknown as { currentTime: number; seeking: boolean }).currentTime = KTV_TILE_SAMPLES * 2 / KTV_SAMPLE_RATE + 0.3;
        (harness.audio as unknown as { currentTime: number; seeking: boolean }).seeking = true;
        harness.handlers.get('seeking')?.();
        expect(first.stop).toHaveBeenCalledOnce();
        (harness.audio as unknown as { currentTime: number; seeking: boolean }).seeking = false;
        harness.handlers.get('seeked')?.();
        expect(harness.sources).toHaveLength(2);
        expect(harness.modes.at(-1)).toBe('instrumental');
        harness.release();
    });
});
