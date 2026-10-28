import { Mic2, Music2, QrCode } from 'lucide-react';
import type { CommandPaletteCommand } from '../types';
import { createToggleCommand, defineCommand } from '../commandFactories';

// The same KTV actions as the dock, exposed through the app-owned command context.
export const ktvCommands: CommandPaletteCommand[] = [
    createToggleCommand('ktv', 'panel', 'KTV console', 'Switch vocals and open a phone song room',
        ['karaoke', '家庭唱歌', '点歌台'], context => context.panel.ktv.open(), { icon: Mic2 }),
    ...(['original', 'instrumental'] as const).map(mode => createToggleCommand(
        `ktv-${mode}`, 'panel', mode === 'original' ? 'KTV: Original vocals' : 'KTV: Instrumental',
        mode === 'original' ? 'Play the original vocals and music' : 'Prepare accompaniment and switch when ready',
        mode === 'original' ? ['vocal on', '恢复人声'] : ['vocal off', '去人声', '消音'],
        context => context.panel.ktv.setMode(mode),
        { icon: mode === 'original' ? Mic2 : Music2, isAvailable: context => context?.panel.ktv.canUseAudio() ?? true },
    )),
    createToggleCommand('ktv-toggle', 'panel', 'KTV: Automatic accompaniment', 'Enable or disable accompaniment preparation',
        ['auto separate', '自动分离'], context => context.panel.ktv.toggle(),
        { isAvailable: context => context?.panel.ktv.canUseAudio() ?? true }),
    createToggleCommand('ktv-retry', 'panel', 'KTV: Retry accompaniment', 'Retry separation for the current track',
        ['separate again', '重新分离'], context => context.panel.ktv.retry(),
        { isAvailable: context => Boolean(context?.shared.currentSong) && (context?.panel.ktv.canUseAudio() ?? false) }),
    ...(['start', 'stop', 'renew'] as const).map(action => defineCommand({
        id: `ktv-room-${action}`, group: 'panel', platform: ['electron'], icon: QrCode,
        title: { start: 'KTV: Open phone room', stop: 'KTV: Close phone room', renew: 'KTV: New QR code' }[action],
        description: { start: 'Create a LAN room and show its QR code', stop: 'End phone access and invalidate the invitation', renew: 'End old sessions and create a fresh invitation' }[action],
        keywords: { start: ['扫码', '手机点歌', 'scan code'], stop: ['断开手机', 'disconnect phones'], renew: ['刷新邀请', 'refresh invitation'] }[action],
        isAvailable: context => action === 'start' || (context?.panel.ktv.roomRunning() ?? false),
        execute: async (_input, context) => { await context.panel.ktv.roomAction(action); return true; },
    })),
    defineCommand({
        id: 'ktv-room-copy', group: 'panel', platform: ['electron'], icon: QrCode,
        title: 'KTV: Copy room link', description: 'Copy the phone song room invitation',
        keywords: ['share invitation', '分享点歌房'],
        isAvailable: context => context?.panel.ktv.roomRunning() ?? false,
        execute: (_input, context) => context.panel.ktv.copyRoomLink(),
    }),
];
