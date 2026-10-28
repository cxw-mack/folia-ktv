import { useKtvStore } from './useKtvStore';

const getRoomError = (error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    return message.includes('KTV_FIREWALL_AUTHORIZATION_DECLINED') ? 'firewallPermissionDeclined'
        : message.includes('KTV_FIREWALL_SETUP_FAILED') ? 'firewallSetupFailed' : 'roomError';
};

const getErrorDetail = (error: unknown) => {
    if (!error || typeof error !== 'object' || !('detail' in error)) return null;
    return typeof error.detail === 'string' ? error.detail.slice(0, 1200) : null;
};

// Serializes user-facing room actions and shares their error state with the console.
export const runKtvRoomAction = async (action: 'start' | 'stop' | 'renew') => {
    const api = window.electron?.ktvRoom;
    if (!api || useKtvStore.getState().roomBusy) return;
    useKtvStore.setState({ roomBusy: true, roomError: null, roomErrorDetail: null });
    try {
        if (action === 'start') {
            const authorization = await api.authorizeLan();
            if (!authorization.allowed) {
                const error = new Error(authorization.reason === 'authorizationDeclined'
                    ? 'KTV_FIREWALL_AUTHORIZATION_DECLINED' : 'KTV_FIREWALL_SETUP_FAILED');
                Object.assign(error, { detail: authorization.detail });
                throw error;
            }
            useKtvStore.setState({ roomFirewallReady: true });
        }
        useKtvStore.setState({ room: await api[action]() });
    }
    catch (error) {
        console.warn('[KTV] room action failed', error);
        useKtvStore.setState({ roomError: getRoomError(error), roomErrorDetail: getErrorDetail(error) });
    } finally { useKtvStore.setState({ roomBusy: false }); }
};

// Requests a one-time, local-subnet-only Windows firewall exception after the host asks to fix phone access.
export const runKtvFirewallAction = async () => {
    const api = window.electron?.ktvRoom;
    if (!api || useKtvStore.getState().roomBusy) return;
    useKtvStore.setState({ roomBusy: true, roomError: null, roomErrorDetail: null, roomFirewallReady: false });
    try {
        const result = await api.authorizeLan();
        if (!result.allowed) {
            const error = new Error(result.reason === 'authorizationDeclined'
                ? 'KTV_FIREWALL_AUTHORIZATION_DECLINED' : 'KTV_FIREWALL_SETUP_FAILED');
            Object.assign(error, { detail: result.detail });
            throw error;
        }
        useKtvStore.setState({ roomFirewallReady: true });
    } catch (error) {
        console.warn('[KTV] local network firewall setup failed', error);
        useKtvStore.setState({ roomError: getRoomError(error), roomErrorDetail: getErrorDetail(error) });
    } finally {
        useKtvStore.setState({ roomBusy: false });
    }
};
