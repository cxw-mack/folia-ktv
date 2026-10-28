import type { AutomixDeckChain } from '../../services/automix/crossfadeGraph';
import type { KtvAudioMode } from '../../types/ktv';
import { instrumentalReadyUntil, KTV_SAMPLE_RATE, KTV_TILE_SAMPLES } from './instrumentalPlan';
import type { InstrumentalTrack } from './instrumentalTrack';

// Keeps accompaniment buffer sources on the media element's clock, including seeks and stalls.
export const createInstrumentalPlayback = ({ audio, context, chain, track, mode, onAudible }: {
    audio: HTMLAudioElement;
    context: AudioContext;
    chain: AutomixDeckChain;
    track: () => InstrumentalTrack | null;
    mode: () => KtvAudioMode;
    onAudible: (mode: KtvAudioMode, readySeconds: number) => void;
}) => {
    let disposed = false;
    let stalled = false;
    let anchor: { time: number; position: number; rate: number } | null = null;
    let audible: KtvAudioMode = 'original';
    let coverage = -1;
    const sources = new Map<number, AudioBufferSourceNode>();
    const stopSources = () => {
        sources.forEach(source => { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); });
        sources.clear();
        anchor = null;
        coverage = -1;
    };
    const gains = (instrumental: boolean, until = Infinity) => {
        const now = context.currentTime;
        const fade = 0.045;
        for (const [param, value] of [[chain.ktvOriginal.gain, instrumental ? 0 : 1], [chain.ktvInstrumental.gain, instrumental ? 1 : 0]] as const) {
            if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
            else param.cancelScheduledValues(now);
            param.setValueAtTime(param.value, now);
            param.linearRampToValueAtTime(value, now + fade);
            if (instrumental && Number.isFinite(until)) {
                const boundary = Math.max(now + fade, until);
                param.setValueAtTime(value, Math.max(now + fade, boundary - fade));
                param.linearRampToValueAtTime(1 - value, boundary);
            }
        }
    };
    const reset = () => {
        stopSources();
        gains(false);
        audible = 'original';
        onAudible(audible, 0);
    };
    const tick = () => {
        if (disposed) return;
        const current = track();
        const position = audio.currentTime;
        const until = current ? instrumentalReadyUntil(current.ready, current.total, position) : position;
        const canPlay = current && mode() === 'instrumental' && !audio.paused && !audio.ended
            && !audio.seeking && !stalled && audio.readyState >= 3 && context.state === 'running'
            // Buffer sources change pitch with rate; keep parity with pitch-preserving media playback.
            && audio.playbackRate === 1 && until - position > 0.09;
        if (!canPlay) {
            if (anchor || audible !== 'original') reset();
            onAudible('original', Math.max(0, until - position));
            return;
        }
        const now = context.currentTime;
        const rate = audio.playbackRate;
        if (anchor && (anchor.rate !== rate || Math.abs(anchor.position + (now - anchor.time) * rate - position) > 0.075)) reset();
        if (!anchor) anchor = { time: now + 0.012, position: position + 0.012 * rate, rate };
        const first = Math.floor(position * KTV_SAMPLE_RATE / KTV_TILE_SAMPLES);
        const last = Math.floor(Math.min(until - 0.0001, position + 1.2 * rate) * KTV_SAMPLE_RATE / KTV_TILE_SAMPLES);
        for (let index = first; index <= last; index += 1) {
            if (sources.has(index)) continue;
            const pcm = current.tiles.get(index);
            if (!pcm) break;
            // Only scheduled tiles become float AudioBuffers; the rest stays compact 16-bit PCM.
            const buffer = context.createBuffer(2, pcm[0].length, KTV_SAMPLE_RATE);
            for (let channel = 0; channel < 2; channel += 1) {
                const output = buffer.getChannelData(channel);
                for (let i = 0; i < output.length; i += 1) output[i] = pcm[channel][i] / 32767;
            }
            const begin = index * KTV_TILE_SAMPLES / KTV_SAMPLE_RATE;
            const when = Math.max(anchor.time, now + 0.004, anchor.time + (begin - anchor.position) / rate);
            const offset = Math.max(0, anchor.position + (when - anchor.time) * rate - begin);
            if (offset >= buffer.duration) continue;
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = rate;
            source.connect(chain.ktvInstrumental);
            source.onended = () => { source.disconnect(); if (sources.get(index) === source) sources.delete(index); };
            sources.set(index, source);
            source.start(when, offset);
        }
        const end = anchor.time + (until - anchor.position) / rate;
        if (audible !== 'instrumental' || coverage !== until) {
            gains(true, end);
            coverage = until;
            audible = 'instrumental';
        }
        onAudible(audible, until - position);
    };
    const onWaiting = () => { stalled = true; reset(); };
    const onPlaying = () => { stalled = false; tick(); };
    const onSeeked = () => { stalled = false; reset(); tick(); };
    const events: Array<[string, () => void]> = [
        ['waiting', onWaiting], ['stalled', onWaiting], ['playing', onPlaying], ['canplay', onPlaying],
        ['pause', reset], ['seeking', reset], ['seeked', onSeeked], ['ratechange', onSeeked],
        ['ended', reset], ['emptied', reset],
    ];
    events.forEach(([event, listener]) => audio.addEventListener(event, listener));
    const timer = setInterval(tick, 40);
    tick();
    return () => {
        disposed = true;
        clearInterval(timer);
        events.forEach(([event, listener]) => audio.removeEventListener(event, listener));
        reset();
    };
};
