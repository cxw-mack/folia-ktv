import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { AutomixDeckChain } from '../../services/automix/crossfadeGraph';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { useKtvStore } from './useKtvStore';
import { prepareInstrumental, type InstrumentalTrack } from './instrumentalTrack';
import { createInstrumentalPlayback } from './instrumentalPlayback';

// Connects current-track generation and the clocked KTV fork without driving App at audio rate.
export const useKtvAudio = ({ audioRef, audioContextRef, getActiveChain, external }: {
    audioRef: RefObject<HTMLAudioElement | null>;
    audioContextRef: RefObject<AudioContext | null>;
    getActiveChain: () => AutomixDeckChain | null;
    external: boolean;
}) => {
    const enabled = useKtvStore(state => state.enabled);
    const retry = useKtvStore(state => state.retry);
    const song = usePlaybackStore(state => state.currentSong);
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const key = song ? getPlaybackSongKey(song) + '@' + (song.playbackSourceRevision ?? '') : null;
    const trackRef = useRef<InstrumentalTrack | null>(null);
    const jobRef = useRef<Promise<void>>(Promise.resolve());
    useEffect(() => {
        trackRef.current = null;
        useKtvStore.setState({ preparation: external ? 'external' : 'idle', engine: null, progress: 0, rtf: null, readySeconds: 0, audibleMode: 'original' });
        if (!enabled || external || !song || !audioSrc) return;
        const controller = new AbortController();
        const job = jobRef.current.catch(() => undefined).then(async () => {
            if (controller.signal.aborted) return;
            await prepareInstrumental({
                song, audioSrc, signal: controller.signal,
                position: () => audioRef.current?.currentTime ?? 0,
                onTrack: track => { trackRef.current = track; },
                onProgress: ({ preparation, engine, progress, rtf }) => useKtvStore.setState({ preparation, engine, progress, ...(rtf !== undefined ? { rtf } : {}) }),
            });
        }).catch(error => {
            if (controller.signal.aborted) return;
            console.error('[KTV] accompaniment preparation failed', error);
            useKtvStore.setState({ preparation: 'failed' });
        });
        jobRef.current = job;
        return () => { controller.abort(); trackRef.current = null; };
        // Metadata hydration must not cancel the same audio; identity and concrete source own this run.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, external, key, audioSrc, retry, audioRef]);

    useEffect(() => {
        if (!enabled || external) return;
        let release: (() => void) | null = null;
        let attached: HTMLAudioElement | null = null;
        let attachedChain: AutomixDeckChain | null = null;
        const attach = () => {
            const audio = audioRef.current;
            const context = audioContextRef.current;
            const chain = getActiveChain();
            if ((audio !== attached || chain !== attachedChain) && release) { release(); release = null; }
            if (!audio || !context || !chain) return;
            if (!release) {
                attached = audio;
                attachedChain = chain;
                release = createInstrumentalPlayback({
                    audio, context, chain,
                    track: () => trackRef.current,
                    mode: () => useKtvStore.getState().mode,
                    onAudible: (audibleMode, readySeconds) => {
                        const state = useKtvStore.getState();
                        if (state.audibleMode !== audibleMode) useKtvStore.setState({ audibleMode });
                        // The panel and LAN snapshot only need a few updates per second.
                        if (Math.abs(state.readySeconds - readySeconds) >= 0.5 || Math.abs(state.position - audio.currentTime) >= 0.5) {
                            useKtvStore.setState({ readySeconds, position: audio.currentTime });
                        }
                    },
                });
            }
        };
        const timer = setInterval(attach, 250);
        attach();
        return () => { clearInterval(timer); release?.(); };
    }, [enabled, external, key, audioSrc, audioRef, audioContextRef, getActiveChain]);
};
