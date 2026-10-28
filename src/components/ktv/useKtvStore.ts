import { create } from 'zustand';
import type { KtvAudioMode, KtvEngine, KtvPreparation, KtvRoomStatus } from '../../types/ktv';

// Session-only KTV controls; generated audio and invitation tokens are never persisted here.
interface KtvState {
    open: boolean;
    enabled: boolean;
    mode: KtvAudioMode;
    audibleMode: KtvAudioMode;
    preparation: KtvPreparation;
    engine: KtvEngine | null;
    progress: number;
    readySeconds: number;
    position: number;
    rtf: number | null;
    retry: number;
    room: KtvRoomStatus | null;
    roomBusy: boolean;
    roomError: 'roomError' | 'firewallPermissionDeclined' | 'firewallSetupFailed' | null;
    roomErrorDetail: string | null;
    roomFirewallReady: boolean;
    setOpen: (open: boolean) => void;
    setEnabled: (enabled: boolean) => void;
    setMode: (mode: KtvAudioMode) => void;
    retryPreparation: () => void;
}

export const useKtvStore = create<KtvState>((set) => ({
    open: false,
    enabled: false,
    mode: 'original',
    audibleMode: 'original',
    preparation: 'idle',
    engine: null,
    progress: 0,
    readySeconds: 0,
    position: 0,
    rtf: null,
    retry: 0,
    room: null,
    roomBusy: false,
    roomError: null,
    roomErrorDetail: null,
    roomFirewallReady: false,
    setOpen: open => set({ open }),
    setEnabled: enabled => set({ enabled, ...(enabled ? {} : { mode: 'original' as const }) }),
    setMode: mode => set({ mode, ...(mode === 'instrumental' ? { enabled: true } : {}) }),
    retryPreparation: () => set(state => ({ retry: state.retry + 1 })),
}));
