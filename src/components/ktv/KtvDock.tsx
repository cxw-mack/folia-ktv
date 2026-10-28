import { useState } from 'react';
import { Mic2, Music2, QrCode, Radio, RefreshCw, Copy, Power, Check, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { copyText } from '../../utils/system/clipboard';
import ThemedDialog from '../shared/ThemedDialog';
import { useKtvStore } from './useKtvStore';
import { useKtvRoom, type KtvQueueActions } from './useKtvRoom';
import { runKtvFirewallAction, runKtvRoomAction } from './roomActions';

// A persistent two-mode switch plus a theme-aware home KTV sheet and its opt-in phone room.
const KtvDock = ({ theme, isDaylight, ...actions }: KtvQueueActions & { theme: Theme; isDaylight: boolean }) => {
    useKtvRoom(actions);
    const open = useKtvStore(state => state.open);
    const mode = useKtvStore(state => state.mode);
    const audibleMode = useKtvStore(state => state.audibleMode);
    const enabled = useKtvStore(state => state.enabled);
    const { t } = useTranslation();
    const ink = isDaylight ? 'text-zinc-900' : 'text-white';
    return <>
        <div className={`fixed right-6 top-16 z-[85] flex items-center gap-1 rounded-full border p-1 shadow-lg backdrop-blur-xl ${ink} ${isDaylight ? 'border-black/10 bg-white/85' : 'border-white/15 bg-zinc-950/75'}`}>
            <button type="button" onClick={() => useKtvStore.getState().setOpen(true)} title={t('ktv.open')} aria-label={t('ktv.open')} className="flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold hover:bg-current/10"><Mic2 size={14} />KTV</button>
            {(['original', 'instrumental'] as const).map(value => <button
                key={value} type="button" aria-pressed={mode === value} disabled={actions.external}
                onClick={() => useKtvStore.getState().setMode(value)}
                className="rounded-full px-3 py-2 text-xs transition-colors disabled:opacity-40"
                style={mode === value ? { background: theme.accentColor, color: theme.backgroundColor } : {}}
            >{t(`ktv.${value}`)}</button>)}
            {enabled && mode === 'instrumental' && audibleMode === 'original' && <span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" title={t('ktv.waiting')} />}
        </div>
        {open && <KtvPanel isDaylight={isDaylight} external={actions.external} />}
    </>;
};

const KtvPanel = ({ isDaylight, external }: { isDaylight: boolean; external: boolean }) => {
    const state = useKtvStore();
    const song = usePlaybackStore(state => state.currentSong);
    const { t } = useTranslation();
    const [inviteIndex, setInviteIndex] = useState(0);
    const [copied, setCopied] = useState(false);
    const invite = state.room?.invites[inviteIndex] || state.room?.invites[0];
    const border = isDaylight ? 'border-black/10 bg-black/[.025]' : 'border-white/10 bg-white/[.025]';
    const button = 'rounded-xl border border-current/15 px-3.5 py-2.5 text-xs font-medium transition hover:bg-current/5 disabled:opacity-40';
    const readyAhead = Math.floor(state.readySeconds);
    return <ThemedDialog isOpen onClose={() => state.setOpen(false)} isDaylight={isDaylight} size="m" title={t('ktv.title')} description={t('ktv.description')}>
        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <section className={`flex min-w-0 flex-col gap-4 rounded-2xl border p-5 ${border}`}>
                <div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[.17em] opacity-45">FOLIA / HOME STAGE</span><Radio size={16} className="opacity-50" /></div>
                <div><div className="mb-1 text-[11px] opacity-50">{t('ktv.currentSong')}</div><h3 className="line-clamp-2 text-xl font-semibold leading-snug">{song?.name || t('ktv.noSong')}</h3><p className="mt-1 truncate text-xs opacity-50">{getSongArtistLabel(song) || t('ktv.pickSong')}</p></div>
                <div className="grid grid-cols-2 gap-2">
                    {(['original', 'instrumental'] as const).map((mode, index) => {
                        const Icon = index ? Music2 : Mic2;
                        return <button key={mode} type="button" aria-pressed={state.mode === mode} disabled={external} onClick={() => state.setMode(mode)} className={`flex flex-col gap-3 rounded-xl border p-4 text-left transition disabled:opacity-40 ${state.mode === mode ? (isDaylight ? 'border-amber-700/40 bg-amber-500/10' : 'border-amber-300/40 bg-amber-200/10') : 'border-current/10'}`}><Icon size={22} /><span className="text-sm font-medium">{t(`ktv.${mode}`)}</span><span className="text-[10px] opacity-50">{t(`ktv.${mode}Hint`)}</span></button>;
                    })}
                </div>
                <div className="flex items-center justify-between gap-3 text-xs"><span>{t('ktv.enable')}</span><button type="button" role="switch" aria-checked={state.enabled} aria-label={t('ktv.enable')} disabled={external} onClick={() => state.setEnabled(!state.enabled)} className={`relative h-6 w-10 rounded-full transition ${state.enabled ? 'bg-amber-500' : 'bg-current/15'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${state.enabled ? 'left-5' : 'left-1'}`} /></button></div>
                <div className={`rounded-xl border p-3.5 ${border}`} aria-live="polite">
                    <div className="flex justify-between gap-2 text-xs"><span>{t(`ktv.status.${external ? 'external' : state.enabled ? state.preparation : 'off'}`)}</span><span className="tabular-nums opacity-55">{Math.round(state.progress * 100)}%</span></div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-current/10"><div className="h-full bg-amber-500 transition-[width] duration-500" style={{ width: `${state.progress * 100}%` }} /></div>
                    <p className="mt-2 text-[11px] leading-relaxed opacity-55">{state.enabled && state.engine ? `${t('ktv.backend', { engine: t(`ktv.${state.engine}`) })} · ` : ''}{state.mode === 'instrumental' && state.audibleMode === 'original' ? t('ktv.waiting') : t('ktv.audible', { mode: t(`ktv.${state.audibleMode}`) })}</p>
                    {state.enabled && <p className="mt-1 text-[10px] opacity-45">{t('ktv.buffer', { seconds: readyAhead })}{state.rtf && state.rtf > 0 ? ` · ${t('ktv.speed', { value: (1 / state.rtf).toFixed(1) })}` : ''}</p>}
                </div>
                {['failed', 'modelMissing', 'sourceUnavailable', 'gpuUnavailable'].includes(state.preparation) && <button type="button" className={button} onClick={() => state.retryPreparation()}><RefreshCw size={12} className="mr-2 inline" />{t('ktv.retry')}</button>}
                <p className="mt-auto text-[10px] leading-relaxed opacity-45">{t('ktv.engineHint')}</p>
            </section>
            <section className={`flex min-w-0 flex-col items-center gap-3 rounded-2xl border p-5 text-center ${border}`}>
                <div className="flex w-full items-center gap-2 text-sm font-semibold"><QrCode size={17} />{t('ktv.phoneTitle')}</div>
                <p className="w-full text-left text-[11px] leading-relaxed opacity-50">{t('ktv.sameWifi')}</p>
                <p className="w-full text-left text-[10px] leading-relaxed opacity-45">{t('ktv.phoneNetworkHelp')}</p>
                {state.room?.running && invite ? <>
                    <p className="w-full break-all text-left text-[10px] font-mono opacity-55">{t('ktv.roomAddress', { address: new URL(invite.url).origin })}</p>
                    <button type="button" disabled={state.roomBusy || state.roomFirewallReady} className={`${button} w-full disabled:cursor-default`} onClick={() => void runKtvFirewallAction()}><ShieldCheck size={13} className="mr-2 inline" />{t(state.roomFirewallReady ? 'ktv.firewallReady' : state.roomBusy ? 'ktv.firewallWorking' : 'ktv.repairLan')}</button>
                    {state.roomFirewallReady && <p role="status" className="text-[10px] text-emerald-500">{t('ktv.firewallReadyHint')}</p>}
                    <div className="rounded-2xl bg-white p-2"><img src={invite.qr} width={176} height={176} alt={t('ktv.qrAlt')} /></div>
                    <p className="text-[11px] opacity-50">{t('ktv.sessions', { count: state.room.sessions })}</p>
                    <button type="button" className={`${button} w-full`} onClick={() => { void copyText(invite.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }}>{copied ? <Check size={13} className="mr-2 inline" /> : <Copy size={13} className="mr-2 inline" />}{t(copied ? 'ktv.copied' : 'ktv.copyLink')}</button>
                    {state.room.invites.length > 1 && <button type="button" className="text-[10px] underline opacity-50" onClick={() => setInviteIndex((inviteIndex + 1) % state.room!.invites.length)}>{t('ktv.nextAddress')} · {new URL(invite.url).host}</button>}
                    {state.room.localOnly && <p className="text-[11px] text-amber-500">{t('ktv.localOnly')}</p>}
                    <div className="flex w-full gap-2"><button type="button" disabled={state.roomBusy} className={`${button} flex-1`} onClick={() => void runKtvRoomAction('renew')}><RefreshCw size={12} className="mr-1 inline" />{t('ktv.renew')}</button><button type="button" disabled={state.roomBusy} className={`${button} flex-1`} onClick={() => void runKtvRoomAction('stop')}><Power size={12} className="mr-1 inline" />{t('ktv.closeRoom')}</button></div>
                    <p className="text-[10px] leading-relaxed opacity-40">{t('ktv.expiryHint')}</p>
                </> : <>
                    <div className="my-3 grid h-36 w-36 place-items-center rounded-2xl border border-dashed border-current/15"><QrCode size={64} strokeWidth={1} className="opacity-20" /></div>
                    <button type="button" disabled={state.roomBusy || !window.electron?.ktvRoom} onClick={() => void runKtvRoomAction('start')} className="w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-amber-950 disabled:opacity-50">{t(state.roomBusy ? 'ktv.opening' : 'ktv.openRoom')}</button>
                    <button type="button" disabled={state.roomBusy || state.roomFirewallReady || !window.electron?.ktvRoom} className={`${button} w-full disabled:cursor-default`} onClick={() => void runKtvFirewallAction()}><ShieldCheck size={13} className="mr-2 inline" />{t(state.roomFirewallReady ? 'ktv.firewallReady' : state.roomBusy ? 'ktv.firewallWorking' : 'ktv.repairLan')}</button>
                    {state.roomFirewallReady && <p role="status" className="text-[10px] text-emerald-500">{t('ktv.firewallReadyHint')}</p>}
                    {!window.electron?.ktvRoom && <p className="text-[11px] opacity-50">{t('ktv.desktopOnly')}</p>}
                </>}
                {state.roomError && <div role="alert" className="max-h-32 w-full min-w-0 overflow-auto rounded-lg bg-red-500/5 p-2 text-left text-xs text-red-500"><p>{t(`ktv.${state.roomError}`)}</p>{state.roomErrorDetail && <p className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed opacity-80">{state.roomErrorDetail}</p>}</div>}
            </section>
        </div>
    </ThemedDialog>;
};

export default KtvDock;
