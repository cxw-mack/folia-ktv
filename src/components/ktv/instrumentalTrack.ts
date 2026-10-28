import type { SongResult } from '../../types';
import { getPlaybackAnalysisTarget } from '../../services/playbackRecovery/representationRegistry';
import { decodeAtRate, readLocalTrackBytes } from '../../services/analysis/trackAudio';
import { decodeTrackAtRate, loadTrackBytes } from '../../services/analysis/trackBytes';
import { isCacheableAudioResponse } from '../../services/playbackRecovery/mediaCacheGuard';
import { whyNotTheSong } from '../../services/wholeSongCheck';
import { refreshModelAvailability } from '../../services/analysis/modelAvailability';
import { probeBeatThisGpu } from '../../services/analysis/beatThisGpu';
import { forgetStemRange, separateStemRange, wantStemRange } from '../../services/analysis/stemRange';
import { cpuThreads } from '../../services/analysis/scheduler';
import type { KtvEngine, KtvPreparation } from '../../types/ktv';
import { separateWithFallback, subtractVocalsFromMix, sumNonVocalStems } from './instrumentalSeparator';
import { KTV_SAMPLE_RATE, nextInstrumentalTile, tileBounds } from './instrumentalPlan';
import { KTV_MAX_INPUT_BYTES, readBoundedAudio } from './boundedAudio';

// Generates only the accompaniment, tile by tile, using Folia's shared htdemucs GPU worker.
export interface InstrumentalTrack {
    total: number;
    tiles: Map<number, [Int16Array, Int16Array]>;
    ready: Set<number>;
}

export interface InstrumentalProgress {
    preparation: KtvPreparation;
    engine: KtvEngine | null;
    progress: number;
    rtf?: number;
}

export const prepareInstrumental = async ({ song, audioSrc, signal, position, onTrack, onProgress }: {
    song: SongResult;
    audioSrc: string;
    signal: AbortSignal;
    position: () => number;
    onTrack: (track: InstrumentalTrack) => void;
    onProgress: (progress: InstrumentalProgress) => void;
}): Promise<void> => {
    const wanted = () => !signal.aborted;
    let engine: KtvEngine | null = null;
    const report = (preparation: KtvPreparation, progress = 0, rtf?: number) => {
        if (wanted()) onProgress({ preparation, engine, progress, rtf });
    };
    report('loading');
    // Ten minutes of stereo PCM plus 16-bit accompaniment stays bounded on home PCs.
    if (song.durationMs > 10 * 60_000) return report('tooLong');
    const availability = await refreshModelAvailability();
    if (!wanted()) return;
    const separateCpu = typeof window !== 'undefined' ? window.electron?.separateStems : undefined;
    const cpuAvailable = availability.htdemucs && typeof separateCpu === 'function';
    if (!availability.htdemucs_gpu && !cpuAvailable) return report('modelMissing');
    let gpuAvailable = availability.htdemucs_gpu && await probeBeatThisGpu();
    if (!wanted()) return;
    if (!gpuAvailable && !cpuAvailable) return report('gpuUnavailable');
    engine = gpuAvailable ? 'gpu' : 'cpu';
    report('loading');
    const { key, representation } = getPlaybackAnalysisTarget(song);
    const { bytes, source } = await loadTrackBytes(key, async () => {
        const local = await readLocalTrackBytes(song, { representation, audioUrl: audioSrc });
        if (!wanted()) return null;
        if (local && 'bytes' in local) return local.bytes;
        if (representation || !/^https?:/.test(audioSrc)) return null;
        const response = await fetch(audioSrc, { signal });
        const blob = await readBoundedAudio(response);
        if (!blob || !isCacheableAudioResponse(response, blob) || await whyNotTheSong(song, audioSrc, blob)) return null;
        return blob.arrayBuffer();
    // Cancellation is this consumer's concern. Shared-byte joiners may still need their own read.
    }).catch(error => {
        if (!wanted()) return { bytes: null, source: 'read' as const };
        throw error;
    });
    if (!wanted()) return;
    if (!bytes || bytes.byteLength > KTV_MAX_INPUT_BYTES) return report('sourceUnavailable');
    const decoded = await decodeTrackAtRate(key, KTV_SAMPLE_RATE, bytes, decodeAtRate, 'ktv', source);
    if (!wanted()) return;
    // Bound the current-track working set. A KTV song is usually a few minutes long.
    if (!decoded) return report('sourceUnavailable');
    if (decoded.duration > 10 * 60) return report('tooLong');
    const left = decoded.getChannelData(0);
    const right = decoded.getChannelData(Math.min(1, decoded.numberOfChannels - 1));
    const track: InstrumentalTrack = { total: decoded.length, tiles: new Map(), ready: new Set() };
    onTrack(track);
    let done = 0;
    let inferenceMs = 0;
    // Kept segments survive adjacent tile requests; the existing 96 MiB LRU bounds this reservation.
    wantStemRange(key, 0, track.total, track.total);
    try {
        while (wanted()) {
            const index = nextInstrumentalTile(track.ready, track.total, position());
            if (index === null) return report('ready', 1, inferenceMs / (done / KTV_SAMPLE_RATE * 1000));
            const { from, to } = tileBounds(index, track.total);
            const started = performance.now();
            const tileLeft = left.subarray(from, to);
            const tileRight = right.subarray(from, to);
            const separated = await separateWithFallback({
                gpuAvailable,
                cpuAvailable,
                stillWanted: wanted,
                onEngine: selected => {
                    engine = selected;
                    report('separating', done / track.total);
                },
                onFailure: (backend, error) => console.warn(`[KTV] ${backend} accompaniment tile failed`, error),
                runGpu: async () => {
                    const stems = await separateStemRange({
                        key, left, right, offset: 0, total: track.total, from, to,
                        options: { key, urgency: 'onScreen', stillWanted: wanted },
                    });
                    return stems ? sumNonVocalStems(stems) : null;
                },
                runCpu: async () => {
                    if (!separateCpu || !wanted()) return null;
                    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : 4;
                    const reply = await separateCpu({
                        left: Float32Array.from(tileLeft),
                        right: Float32Array.from(tileRight),
                        threads: cpuThreads(cores, 'quiet', 'htdemucs'),
                    });
                    if (!reply || 'declined' in reply || !reply.vocals) return null;
                    return subtractVocalsFromMix(tileLeft, tileRight, reply.vocals);
                },
            });
            if (!wanted()) return;
            if (!separated) return report('failed', done / track.total);
            if (separated.engine === 'cpu') gpuAvailable = false;
            const instrumental = separated.result;
            const channels: [Int16Array, Int16Array] = [new Int16Array(to - from), new Int16Array(to - from)];
            // Keep stereo separated; the CPU model returns vocals and derives accompaniment by subtraction.
            for (let channel = 0; channel < 2; channel += 1) {
                const output = channels[channel];
                for (let i = 0; i < output.length; i += 1) {
                    const value = instrumental[channel][i];
                    output[i] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
                }
            }
            track.tiles.set(index, channels);
            track.ready.add(index);
            done += to - from;
            inferenceMs += performance.now() - started;
            report('separating', done / track.total, inferenceMs / (done / KTV_SAMPLE_RATE * 1000));
        }
    } finally {
        forgetStemRange(key, 0, track.total, track.total);
    }
};
