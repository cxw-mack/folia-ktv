// Contracts shared by the desktop KTV controller and its narrow LAN bridge.
export type KtvAudioMode = 'original' | 'instrumental';
export type KtvRoomControl = 'previous' | 'next' | 'togglePlayback' | 'setMode' | 'setEnabled' | 'retry';
export type KtvEngine = 'gpu' | 'cpu';
export type KtvPreparation = 'idle' | 'loading' | 'separating' | 'ready' | 'modelMissing' | 'gpuUnavailable' | 'sourceUnavailable' | 'tooLong' | 'failed' | 'external';

export interface KtvTrackView {
    id: string;
    title: string;
    artist: string;
    duration: number;
    source: string;
}

export interface KtvSnapshot {
    current: KtvTrackView | null;
    queue: KtvTrackView[];
    playing: boolean;
    mode: KtvAudioMode;
    enabled: boolean;
    audibleMode: KtvAudioMode;
    engine: KtvEngine | null;
    preparation: KtvPreparation;
    progress: number;
    readySeconds: number;
    position: number;
    onlineSource: string;
    external: boolean;
    dictionary: Record<string, string>;
}

export interface KtvRoomStatus {
    running: boolean;
    generation: string;
    invites: Array<{ url: string; qr: string }>;
    expiresAt: number;
    sessions: number;
    localOnly: boolean;
}

export interface KtvRoomRequest {
    requestId: string;
    generation: string;
    sessionId: string;
    action: 'search' | 'enqueue' | 'control';
    query?: string;
    source?: 'online' | 'local';
    resultId?: string;
    operationId?: string;
    control?: KtvRoomControl;
    value?: KtvAudioMode | boolean;
}

export interface KtvRoomReply {
    requestId: string;
    generation: string;
    ok: boolean;
    data?: unknown;
    error?: string;
}

export interface KtvRoomApi {
    start: () => Promise<KtvRoomStatus>;
    authorizeLan: () => Promise<{ allowed: boolean; alreadyConfigured?: boolean; reason?: string; detail?: string }>;
    stop: () => Promise<KtvRoomStatus>;
    status: () => Promise<KtvRoomStatus>;
    renew: () => Promise<KtvRoomStatus>;
    publish: (snapshot: KtvSnapshot) => Promise<void>;
    complete: (reply: KtvRoomReply) => Promise<void>;
    onRequest: (callback: (request: KtvRoomRequest) => void) => () => void;
    isPending: (requestId: string, generation: string) => Promise<boolean>;
}
