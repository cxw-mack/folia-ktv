import { describe, expect, it, vi } from 'vitest';
import { separateWithFallback, subtractVocalsFromMix, sumNonVocalStems } from '../../../src/components/ktv/instrumentalSeparator';

// Pins GPU-first selection, CPU fallback, cancellation, and the stereo mix used by the KTV path.
describe('KTV accompaniment separator', () => {
    it('prefers GPU when both engines are available', async () => {
        const runGpu = vi.fn(async () => 'gpu-result');
        const runCpu = vi.fn(async () => 'cpu-result');
        const engines: string[] = [];

        await expect(separateWithFallback({ gpuAvailable: true, cpuAvailable: true, runGpu, runCpu, onEngine: engine => engines.push(engine) }))
            .resolves.toEqual({ engine: 'gpu', result: 'gpu-result' });
        expect(runCpu).not.toHaveBeenCalled();
        expect(engines).toEqual(['gpu']);
    });

    it('selects CPU directly when GPU is unavailable', async () => {
        const runGpu = vi.fn(async () => 'gpu-result');
        const runCpu = vi.fn(async () => 'cpu-result');

        await expect(separateWithFallback({ gpuAvailable: false, cpuAvailable: true, runGpu, runCpu }))
            .resolves.toEqual({ engine: 'cpu', result: 'cpu-result' });
        expect(runGpu).not.toHaveBeenCalled();
    });

    it('falls back to CPU when a GPU run returns no result or throws', async () => {
        const runCpu = vi.fn(async () => 'cpu-result');
        const runNullGpu = vi.fn(async () => null);
        await expect(separateWithFallback({ gpuAvailable: true, cpuAvailable: true, runGpu: runNullGpu, runCpu }))
            .resolves.toEqual({ engine: 'cpu', result: 'cpu-result' });

        const gpuError = new Error('device lost');
        const onFailure = vi.fn();
        await expect(separateWithFallback({
            gpuAvailable: true, cpuAvailable: true,
            runGpu: async () => { throw gpuError; }, runCpu, onFailure,
        })).resolves.toEqual({ engine: 'cpu', result: 'cpu-result' });
        expect(onFailure).toHaveBeenCalledWith('gpu', gpuError);
    });

    it('does not start a CPU fallback after the caller cancels', async () => {
        const runCpu = vi.fn(async () => 'cpu-result');
        await expect(separateWithFallback({
            gpuAvailable: true, cpuAvailable: true,
            runGpu: async () => null, runCpu, stillWanted: () => false,
        })).resolves.toBeNull();
        expect(runCpu).not.toHaveBeenCalled();
    });

    it('returns no engine when neither backend is available', async () => {
        const runGpu = vi.fn(async () => 'gpu-result');
        const runCpu = vi.fn(async () => 'cpu-result');
        await expect(separateWithFallback({ gpuAvailable: false, cpuAvailable: false, runGpu, runCpu })).resolves.toBeNull();
        expect(runGpu).not.toHaveBeenCalled();
        expect(runCpu).not.toHaveBeenCalled();
    });

    it('sums the non-vocal stereo stems and subtracts vocals for the CPU path', () => {
        const stems = [1, 2, 3, 99].map(value => ({ left: Float32Array.of(value), right: Float32Array.of(-value) }));
        expect(sumNonVocalStems(stems)).toEqual([Float32Array.of(6), Float32Array.of(-6)]);
        expect(subtractVocalsFromMix(Float32Array.of(0.8), Float32Array.of(-0.8), {
            left: Float32Array.of(0.3), right: Float32Array.of(-0.3),
        })).toEqual([Float32Array.of(0.5), Float32Array.of(-0.5)]);
        expect(subtractVocalsFromMix(Float32Array.of(1), Float32Array.of(1), {
            left: Float32Array.of(1, 2), right: Float32Array.of(1),
        })).toBeNull();
    });
});
