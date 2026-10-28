import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KtvRoomApi } from '../../../src/types/ktv';
import { runKtvFirewallAction, runKtvRoomAction } from '../../../src/components/ktv/roomActions';
import { useKtvStore } from '../../../src/components/ktv/useKtvStore';

// Tests the KTV panel's handling of Electron IPC success and wrapped firewall authorization errors.
describe('KTV room actions', () => {
    let api: Partial<KtvRoomApi>;

    beforeEach(() => {
        useKtvStore.setState({ roomBusy: false, roomError: null, roomErrorDetail: null, roomFirewallReady: false });
        api = { authorizeLan: vi.fn().mockResolvedValue({ allowed: true, alreadyConfigured: false }), start: vi.fn().mockResolvedValue({ running: true }) };
        vi.stubGlobal('window', { electron: { ktvRoom: api } });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('marks LAN access ready after the host authorizes the firewall rule', async () => {
        vi.mocked(api.authorizeLan!).mockResolvedValue({ allowed: true, alreadyConfigured: false });

        await runKtvFirewallAction();

        expect(api.authorizeLan).toHaveBeenCalledOnce();
        expect(useKtvStore.getState()).toMatchObject({ roomBusy: false, roomError: null, roomFirewallReady: true });
    });

    it('shows the specific permission guidance for Electron-wrapped UAC cancellation', async () => {
        vi.mocked(api.authorizeLan!).mockRejectedValue(new Error(
            "Error invoking remote method 'ktv-room-authorize-lan': Error: KTV_FIREWALL_AUTHORIZATION_DECLINED",
        ));

        await runKtvFirewallAction();

        expect(useKtvStore.getState()).toMatchObject({ roomBusy: false, roomError: 'firewallPermissionDeclined', roomFirewallReady: false });
    });

    it('recognizes firewall failures wrapped by room startup IPC', async () => {
        api.start = vi.fn().mockRejectedValue(new Error(
            "Error invoking remote method 'ktv-room-start': Error: KTV_FIREWALL_SETUP_FAILED",
        ));

        await runKtvRoomAction('start');

        expect(useKtvStore.getState().roomError).toBe('firewallSetupFailed');
    });

    it('authorizes LAN access before starting the phone room', async () => {
        await runKtvRoomAction('start');

        expect(api.authorizeLan).toHaveBeenCalledOnce();
        expect(api.start).toHaveBeenCalledOnce();
        expect(useKtvStore.getState()).toMatchObject({ roomFirewallReady: true, room: { running: true }, roomError: null });
    });

    it('does not start the room when the Windows authorization is declined', async () => {
        vi.mocked(api.authorizeLan!).mockRejectedValue(new Error('KTV_FIREWALL_AUTHORIZATION_DECLINED'));

        await runKtvRoomAction('start');

        expect(api.start).not.toHaveBeenCalled();
        expect(useKtvStore.getState().roomError).toBe('firewallPermissionDeclined');
    });

    it('distinguishes a declined repair permission from a firewall configuration failure', async () => {
        vi.mocked(api.authorizeLan!).mockResolvedValue({ allowed: false, reason: 'authorizationDeclined' });

        await runKtvFirewallAction();

        expect(useKtvStore.getState().roomError).toBe('firewallPermissionDeclined');
    });

    it('retains the Windows firewall failure detail for display in the KTV panel', async () => {
        vi.mocked(api.authorizeLan!).mockResolvedValue({
            allowed: false,
            reason: 'setupFailed',
            detail: 'FOLIA_RULE_CREATE_FAILED:1:error|Access is denied',
        });

        await runKtvFirewallAction();

        expect(useKtvStore.getState()).toMatchObject({
            roomError: 'firewallSetupFailed',
            roomErrorDetail: 'FOLIA_RULE_CREATE_FAILED:1:error|Access is denied',
        });
    });
});
