import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayerState, type LocalSong, type SongResult } from '../../types';
import type { NextTrackOptions, PlaybackNavigationOptions } from '../../types/appPlayback';
import type { KtvRoomRequest, KtvSnapshot, KtvTrackView } from '../../types/ktv';
import { omni } from '../../services/onlineMusic/omni';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { isSongUnavailable } from '../../services/onlineMusic/songAvailability';
import { buildUnifiedLocalSong } from '../../services/playbackAdapters';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { selectDisplayPlayerState, usePlaybackStore } from '../../stores/usePlaybackStore';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { currentTime } from '../../stores/motionSignals';
import { useKtvStore } from './useKtvStore';

// A phone may enqueue only a result returned to its own live session by Omni or the local catalog.
export interface KtvQueueActions {
    external: boolean;
    localSongs: LocalSong[];
    onAddOnline: (songs: SongResult[], options?: { suppressToast?: boolean }) => number;
    onAddLocal: (song: LocalSong) => void | Promise<void>;
    onPlay: (song: SongResult, queue?: SongResult[], isFmCall?: boolean, options?: PlaybackNavigationOptions) => void | Promise<void>;
    onPrevious: (options?: PlaybackNavigationOptions) => void;
    onNext: (options?: NextTrackOptions) => void | Promise<void>;
    onTogglePlayback: () => void;
}

const phoneTextKeys = [
    'title', 'nowPlaying', 'currentSong', 'connecting', 'sameWifi', 'noSong', 'chooseSong',
    'search', 'searchPlaceholder', 'searchHint', 'searching', 'noResults', 'resultsHint',
    'requestSong', 'adding', 'added', 'queue', 'queueEmpty', 'footer', 'original', 'instrumental',
    'online', 'local', 'roomClosed', 'rateLimited', 'roomFull', 'timeout', 'unavailable',
    'forbidden', 'invalidRequest', 'resultExpired', 'external',
    'previous', 'next', 'play', 'pause', 'enable', 'buffer', 'engineHint',
    'retry',
    'status_idle', 'status_off', 'status_loading', 'status_separating', 'status_ready',
    'status_modelMissing', 'status_gpuUnavailable', 'status_sourceUnavailable', 'status_tooLong', 'status_failed', 'status_external',
] as const;

const trackView = (song: SongResult, id = getPlaybackSongKey(song)): KtvTrackView => ({
    id, title: song.name, artist: getSongArtistLabel(song), duration: song.durationMs / 1000,
    source: song.sourceRef?.kind === 'online' ? omni.getProviderLabel(song.sourceRef.providerId) : song.sourceRef?.kind || '',
});

export const useKtvRoom = (actions: KtvQueueActions) => {
    const { t } = useTranslation();
    const latest = useRef({ ...actions, t });
    latest.current = { ...actions, t };
    useEffect(() => {
        const api = window.electron?.ktvRoom;
        if (!api) return;
        let disposed = false;
        let publishing = false;
        let polling = false;
        let ticks = 0;
        const results = new Map<string, { song: SongResult; local?: LocalSong; generation: string; sessionId: string; expiresAt: number }>();
        const buildSnapshot = (): KtvSnapshot => {
            const state = useKtvStore.getState();
            const playback = usePlaybackStore.getState();
            const songKey = playback.currentSong && getPlaybackSongKey(playback.currentSong);
            const index = playback.playQueue.findIndex(song => getPlaybackSongKey(song) === songKey);
            const queue = playback.playQueue.slice(index + 1, index + 101);
            return {
                current: playback.currentSong ? trackView(playback.currentSong) : null,
                queue: queue.map(song => trackView(song)), playing: selectDisplayPlayerState(playback) === PlayerState.PLAYING,
                mode: state.mode, enabled: state.enabled, audibleMode: state.audibleMode,
                engine: state.engine, preparation: state.preparation,
                progress: state.progress, readySeconds: state.readySeconds, position: currentTime.get(), external: latest.current.external,
                onlineSource: omni.getProviderLabel(useOnlineProviderAccountStore.getState().activeProviderId),
                dictionary: Object.fromEntries(phoneTextKeys.map(key => [key, latest.current.t(`ktv.phone.${key}`)])),
            };
        };
        const publishSnapshot = async () => {
            try { await api.publish(buildSnapshot()); }
            catch (error) { console.warn('[KTV] could not publish player state', error); }
        };
        const handle = async (request: KtvRoomRequest) => {
            const reply = (ok: boolean, data?: unknown, error?: string) => api.complete({
                requestId: request.requestId, generation: request.generation, ok, data, error,
            });
            try {
                if (disposed || !await api.isPending(request.requestId, request.generation)) return;
                if (latest.current.external) return void await reply(false, undefined, 'external');
                if (request.action === 'control') {
                    const playback = usePlaybackStore.getState();
                    switch (request.control) {
                        case 'previous':
                            if (playback.currentSong) latest.current.onPrevious({ shouldNavigateToPlayer: false });
                            break;
                        case 'next':
                            if (playback.currentSong) await latest.current.onNext({ shouldNavigateToPlayer: false });
                            break;
                        case 'togglePlayback':
                            if (playback.currentSong) latest.current.onTogglePlayback();
                            break;
                        case 'setMode':
                            if (request.value === 'original' || request.value === 'instrumental') useKtvStore.getState().setMode(request.value);
                            else return void await reply(false, undefined, 'invalidRequest');
                            break;
                        case 'setEnabled':
                            if (typeof request.value === 'boolean') useKtvStore.getState().setEnabled(request.value);
                            else return void await reply(false, undefined, 'invalidRequest');
                            break;
                        case 'retry':
                            useKtvStore.getState().retryPreparation();
                            break;
                        default:
                            return void await reply(false, undefined, 'invalidRequest');
                    }
                    await publishSnapshot();
                    return void await reply(true, { controlled: true });
                }
                for (const [id, item] of results) {
                    if (item.expiresAt < Date.now() || item.generation !== request.generation) results.delete(id);
                }
                if (request.action === 'search') {
                    const query = (request.query || '').trim();
                    const local = request.source === 'local';
                    const localRows = local ? latest.current.localSongs.filter(song => {
                        const display = buildUnifiedLocalSong({ localSong: song, matchedSong: null, coverUrl: null, preferOnlineMetadata: false });
                        return `${display.name} ${getSongArtistLabel(display)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
                    }).slice(0, 12) : [];
                    const songs = local ? localRows.map(song => buildUnifiedLocalSong({ localSong: song, matchedSong: null, coverUrl: null, preferOnlineMetadata: false }))
                        : (await omni.searchSongs(query, { limit: 12, offset: 0 })).items.filter(song => !isSongUnavailable(song));
                    if (disposed || !await api.isPending(request.requestId, request.generation)) return;
                    const rows = songs.slice(0, 12).map((song, index) => {
                        const id = crypto.randomUUID();
                        results.set(id, { song, local: local ? localRows[index] : undefined, generation: request.generation,
                            sessionId: request.sessionId, expiresAt: Date.now() + 10 * 60_000 });
                        return trackView(song, id);
                    });
                    while (results.size > 512) results.delete(results.keys().next().value!);
                    await reply(true, rows);
                } else {
                    const found = results.get(request.resultId || '');
                    if (!found || found.sessionId !== request.sessionId || found.generation !== request.generation || found.expiresAt < Date.now()) {
                        return void await reply(false, undefined, 'resultExpired');
                    }
                    if (!await api.isPending(request.requestId, request.generation) || disposed) return;
                    if (latest.current.external) return void await reply(false, undefined, 'external');
                    const wasEmpty = !usePlaybackStore.getState().currentSong;
                    if (found.local) await latest.current.onAddLocal(found.local);
                    else if (!latest.current.onAddOnline([found.song], { suppressToast: true })) return void await reply(false, undefined, 'unavailable');
                    await reply(true, { added: true });
                    if (wasEmpty) {
                        const playback = usePlaybackStore.getState();
                        const song = playback.playQueue.find(song => getPlaybackSongKey(song) === getPlaybackSongKey(found.song));
                        if (song && !playback.currentSong) {
                            void Promise.resolve(latest.current.onPlay(song, playback.playQueue, false, { shouldNavigateToPlayer: false }))
                                .catch(error => console.warn('[KTV] could not start the first requested song', error));
                        }
                    }
                }
            } catch (error) {
                console.warn('[KTV] phone request failed', error);
                await reply(false, undefined, 'unavailable').catch(() => undefined);
            }
        };
        const unsubscribe = api.onRequest(request => { void handle(request); });
        const publish = async () => {
            const state = useKtvStore.getState();
            if (state.room?.running && !publishing) {
                publishing = true;
                try { await publishSnapshot(); }
                finally { publishing = false; }
            }
            if (ticks++ % 4 !== 0 || polling || (!state.open && !state.room?.running)) return;
            polling = true;
            try {
                const room = await api.status();
                if (!disposed && !useKtvStore.getState().roomBusy && useKtvStore.getState().room === state.room) {
                    if (state.room?.generation !== room.generation) results.clear();
                    useKtvStore.setState({ room });
                }
            } catch { /* The room panel reports failures of explicit actions. */ }
            finally { polling = false; }
        };
        const timer = setInterval(() => { void publish(); }, 500);
        void publish();
        return () => { disposed = true; clearInterval(timer); unsubscribe(); results.clear(); };
    }, []);
};
