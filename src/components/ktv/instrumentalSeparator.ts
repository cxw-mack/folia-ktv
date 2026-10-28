// Chooses the KTV inference backend and falls back without changing the track-generation loop.
export type InstrumentalEngine = 'gpu' | 'cpu';

export interface InstrumentalSeparationResult<T> {
    engine: InstrumentalEngine;
    result: T;
}

export interface InstrumentalStem {
    left: Float32Array;
    right: Float32Array;
}

export const sumNonVocalStems = (stems: readonly InstrumentalStem[]): [Float32Array, Float32Array] | null => {
    if (stems.length < 4) return null;
    const length = stems[0].left.length;
    if (stems.slice(0, 4).some(stem => stem.left.length !== length || stem.right.length !== length)) return null;
    const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
    for (let channel = 0; channel < 2; channel += 1) {
        const side = channel === 0 ? 'left' : 'right';
        const output = channels[channel];
        for (let index = 0; index < length; index += 1) {
            output[index] = stems[0][side][index] + stems[1][side][index] + stems[2][side][index];
        }
    }
    return channels;
};

export const subtractVocalsFromMix = (
    left: Float32Array,
    right: Float32Array,
    vocals: InstrumentalStem,
): [Float32Array, Float32Array] | null => {
    if (left.length !== right.length || vocals.left.length !== left.length || vocals.right.length !== right.length) return null;
    const channels: [Float32Array, Float32Array] = [new Float32Array(left.length), new Float32Array(right.length)];
    for (let index = 0; index < left.length; index += 1) {
        channels[0][index] = left[index] - vocals.left[index];
        channels[1][index] = right[index] - vocals.right[index];
    }
    return channels;
};

export const separateWithFallback = async <T>({
    gpuAvailable,
    cpuAvailable,
    runGpu,
    runCpu,
    onEngine,
    onFailure,
    stillWanted = () => true,
}: {
    gpuAvailable: boolean;
    cpuAvailable: boolean;
    runGpu: () => Promise<T | null>;
    runCpu: () => Promise<T | null>;
    onEngine?: (engine: InstrumentalEngine) => void;
    onFailure?: (engine: InstrumentalEngine, error: unknown) => void;
    stillWanted?: () => boolean;
}): Promise<InstrumentalSeparationResult<T> | null> => {
    if (gpuAvailable) {
        onEngine?.('gpu');
        try {
            const result = await runGpu();
            if (result !== null) return { engine: 'gpu', result };
        } catch (error) {
            onFailure?.('gpu', error);
        }
    }
    if (!stillWanted() || !cpuAvailable) return null;
    onEngine?.('cpu');
    try {
        const result = await runCpu();
        return result === null ? null : { engine: 'cpu', result };
    } catch (error) {
        onFailure?.('cpu', error);
        return null;
    }
};
