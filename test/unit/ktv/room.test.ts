import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

// Exercises the actual LAN HTTP boundary, desktop handoff, QR rotation, and shutdown lifecycle.
const require = createRequire(import.meta.url);
const { createKtvRoom } = require('../../../electron/ktv/room.cjs') as {
    createKtvRoom: (options: Record<string, unknown>) => {
        start: () => Promise<{ running: boolean; generation: string; invites: Array<{ url: string }> }>;
        renew: () => Promise<{ running: boolean; generation: string; invites: Array<{ url: string }> }>;
        stop: () => Promise<unknown>;
        status: () => { running: boolean };
        publish: (value: unknown) => void;
        complete: (reply: Record<string, unknown>) => void;
    };
};

const rooms: Array<ReturnType<typeof createKtvRoom>> = [];
const createRoom = (onRequest: (request: Record<string, unknown>) => void, requestTimeout = 300) => {
    const room = createKtvRoom({ onRequest, interfaces: () => ({ test: [{ address: '192.168.1.20', family: 'IPv4', internal: false }] }), requestTimeout });
    rooms.push(room);
    return room;
};
const endpoint = (invite: { url: string }) => `http://127.0.0.1:${new URL(invite.url).port}`;
const inviteToken = (invite: { url: string }) => new URL(invite.url).searchParams.get('token')!;
const join = async (base: string, token: string) => fetch(`${base}/api/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
});
const auth = (sessionId: string) => ({ Authorization: `Bearer ${sessionId}`, 'Content-Type': 'application/json' });
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));
const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 1000;
    while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    expect(condition()).toBe(true);
};

afterEach(async () => { await Promise.all(rooms.splice(0).map(room => room.stop())); });

describe('KTV LAN song room', () => {
    it('requires the QR token, rejects foreign origins, and publishes only desktop state', async () => {
        const room = createRoom(() => undefined);
        const started = await room.start();
        const base = endpoint(started.invites[0]);
        const inviteUrl = new URL(started.invites[0].url);
        const token = inviteToken(started.invites[0]);
        expect(token).toMatch(/^[\w-]{32}$/);
        expect(inviteUrl.hash).toBe('');
        const localInviteUrl = new URL(started.invites[0].url);
        localInviteUrl.hostname = '127.0.0.1';
        expect((await fetch(localInviteUrl.href)).headers.get('content-type')).toContain('text/html');
        expect((await fetch(`${base}/mobile.js`)).headers.get('content-type')).toContain('javascript');
        expect((await fetch(`${base}/api/join`, { method: 'POST', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
        expect((await join(base, 'bad-token')).status).toBe(401);
        const joined = await (await join(base, token)).json() as { data: { sessionId: string } };
        room.publish({ current: { title: 'Now playing' }, queue: [] });
        const snapshot = await fetch(`${base}/api/snapshot`, { headers: { Authorization: `Bearer ${joined.data.sessionId}` } });
        expect(await snapshot.json()).toMatchObject({ ok: true, data: { current: { title: 'Now playing' }, queue: [] } });
    });

    it('hands searches to the desktop and deduplicates a repeated queue request', async () => {
        const requests: Array<Record<string, unknown>> = [];
        let room!: ReturnType<typeof createRoom>;
        room = createRoom(request => requests.push(request));
        const started = await room.start();
        const base = endpoint(started.invites[0]);
        const token = inviteToken(started.invites[0]);
        const session = (await (await join(base, token)).json() as { data: { sessionId: string } }).data.sessionId;
        const search = fetch(`${base}/api/request`, { method: 'POST', headers: auth(session), body: JSON.stringify({ action: 'search', query: '夜曲', source: 'online' }) });
        await waitFor(() => requests.length === 1);
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ action: 'search', query: '夜曲', source: 'online', generation: started.generation });
        room.complete({ requestId: requests[0].requestId, generation: started.generation, ok: true, data: [{ id: 'opaque-result' }] });
        expect(await (await search).json()).toMatchObject({ ok: true, data: [{ id: 'opaque-result' }] });

        const body = JSON.stringify({ action: 'enqueue', resultId: 'opaque-result', operationId: 'ktv-op-00000001' });
        const first = fetch(`${base}/api/request`, { method: 'POST', headers: auth(session), body });
        const second = fetch(`${base}/api/request`, { method: 'POST', headers: auth(session), body });
        await waitFor(() => requests.filter(request => request.action === 'enqueue').length === 1);
        expect(requests.filter(request => request.action === 'enqueue')).toHaveLength(1);
        const enqueue = requests.find(request => request.action === 'enqueue')!;
        room.complete({ requestId: enqueue.requestId, generation: started.generation, ok: true, data: { added: true } });
        expect(await (await first).json()).toMatchObject({ ok: true, data: { added: true } });
        expect(await (await second).json()).toMatchObject({ ok: true, data: { added: true } });
    });

    it('authenticates and forwards phone playback and accompaniment controls', async () => {
        const requests: Array<Record<string, unknown>> = [];
        const room = createRoom(request => requests.push(request));
        const started = await room.start();
        const base = endpoint(started.invites[0]);
        const token = inviteToken(started.invites[0]);
        const session = (await (await join(base, token)).json() as { data: { sessionId: string } }).data.sessionId;
        const sendControl = (body: unknown) => fetch(`${base}/api/control`, { method: 'POST', headers: auth(session), body: JSON.stringify(body) });

        expect((await fetch(`${base}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'next' }) })).status).toBe(401);
        expect((await sendControl({ action: 'unknown' })).status).toBe(400);
        expect((await sendControl({ action: 'setMode', value: 'karaoke' })).status).toBe(400);
        expect((await sendControl({ action: 'setEnabled', value: 'true' })).status).toBe(400);

        const pending = sendControl({ action: 'setMode', value: 'instrumental' });
        await waitFor(() => requests.length === 1);
        expect(requests[0]).toMatchObject({ action: 'control', control: 'setMode', value: 'instrumental', generation: started.generation });
        room.complete({ requestId: requests[0].requestId, generation: started.generation, ok: true, data: { controlled: true } });
        expect(await (await pending).json()).toMatchObject({ ok: true, data: { controlled: true } });
    });

    it('invalidates old sessions and links when the host renews the QR code', async () => {
        const room = createRoom(() => undefined);
        const old = await room.start();
        const oldBase = endpoint(old.invites[0]);
        const oldToken = inviteToken(old.invites[0]);
        const session = (await (await join(oldBase, oldToken)).json() as { data: { sessionId: string } }).data.sessionId;
        const renewed = await room.renew();
        expect(renewed.generation).not.toBe(old.generation);
        expect((await fetch(`${oldBase}/api/snapshot`, { headers: { Authorization: `Bearer ${session}` } })).status).toBe(401);
        expect((await join(oldBase, oldToken)).status).toBe(401);
    });

    it('expires unanswered desktop actions and closes immediately if shutdown races startup', async () => {
        const room = createRoom(() => undefined, 20);
        const started = await room.start();
        const base = endpoint(started.invites[0]);
        const token = inviteToken(started.invites[0]);
        const session = (await (await join(base, token)).json() as { data: { sessionId: string } }).data.sessionId;
        const pending = fetch(`${base}/api/request`, { method: 'POST', headers: auth(session), body: JSON.stringify({ action: 'search', query: 'test' }) });
        expect(await (await pending).json()).toMatchObject({ ok: false, error: 'timeout' });
        await room.stop();

        const racing = createRoom(() => undefined);
        const opening = racing.start();
        const closing = racing.stop();
        await Promise.all([opening, closing]);
        expect(racing.status().running).toBe(false);
    });

});
