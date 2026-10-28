// Sample boundaries and priority rules for progressive, seek-aware accompaniment generation.
export const KTV_SAMPLE_RATE = 44100;
export const KTV_TILE_SAMPLES = 258048;

export const nextInstrumentalTile = (ready: ReadonlySet<number>, total: number, position: number): number | null => {
    const count = Math.ceil(total / KTV_TILE_SAMPLES);
    if (!count) return null;
    const current = Math.min(count - 1, Math.max(0, Math.floor(position * KTV_SAMPLE_RATE / KTV_TILE_SAMPLES)));
    for (let at = current; at < count; at += 1) if (!ready.has(at)) return at;
    for (let at = 0; at < current; at += 1) if (!ready.has(at)) return at;
    return null;
};

export const tileBounds = (index: number, total: number) => ({
    from: index * KTV_TILE_SAMPLES,
    to: Math.min(total, (index + 1) * KTV_TILE_SAMPLES),
});

/** A gap ends a playable run; a ready tile after the gap must never mask it. */
export const instrumentalReadyUntil = (ready: ReadonlySet<number>, total: number, position: number): number => {
    const start = Math.max(0, Math.floor(position * KTV_SAMPLE_RATE / KTV_TILE_SAMPLES));
    let index = start;
    while (ready.has(index)) index += 1;
    return index === start ? position : Math.min(total, index * KTV_TILE_SAMPLES) / KTV_SAMPLE_RATE;
};
