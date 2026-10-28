import { describe, expect, it } from 'vitest';
import { instrumentalReadyUntil, KTV_SAMPLE_RATE, KTV_TILE_SAMPLES, nextInstrumentalTile, tileBounds } from '../../../src/components/ktv/instrumentalPlan';

// Keeps progressive separation ordered around the playhead and avoids claiming readiness across gaps.
describe('instrumental segment plan', () => {
    it('prefers the current tile, then fills from the start after the tail', () => {
        expect(nextInstrumentalTile(new Set([0, 2]), KTV_TILE_SAMPLES * 4, 2.2 * KTV_TILE_SAMPLES / KTV_SAMPLE_RATE)).toBe(3);
        expect(nextInstrumentalTile(new Set([0, 2, 3]), KTV_TILE_SAMPLES * 4, 2.2 * KTV_TILE_SAMPLES / KTV_SAMPLE_RATE)).toBe(1);
        expect(nextInstrumentalTile(new Set([0]), KTV_TILE_SAMPLES, 0)).toBeNull();
    });

    it('bounds the last partial tile and only reports contiguous playable coverage', () => {
        expect(tileBounds(2, KTV_TILE_SAMPLES * 2 + 17)).toEqual({ from: KTV_TILE_SAMPLES * 2, to: KTV_TILE_SAMPLES * 2 + 17 });
        expect(instrumentalReadyUntil(new Set([0, 2]), KTV_TILE_SAMPLES * 3, 1)).toBe(KTV_TILE_SAMPLES / KTV_SAMPLE_RATE);
        expect(instrumentalReadyUntil(new Set([0, 1]), KTV_TILE_SAMPLES * 3, 0.5)).toBe(KTV_TILE_SAMPLES * 2 / KTV_SAMPLE_RATE);
        expect(instrumentalReadyUntil(new Set(), KTV_TILE_SAMPLES, 1.25)).toBe(1.25);
    });
});
