// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

// Runs the served phone page script in a real DOM to verify QR join and reconnect behavior.
const html = readFileSync(resolve(process.cwd(), 'electron/ktv/mobile.html'), 'utf8');
const script = readFileSync(resolve(process.cwd(), 'electron/ktv/mobile.js'), 'utf8');
type PhoneWindow = {
    fetch: typeof fetch;
    setInterval: typeof window.setInterval;
    eval: (source: string) => unknown;
    sessionStorage: Storage;
    location: Location;
    document: Document;
    Event: typeof Event;
    close: () => void;
};
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as {
    JSDOM: new (markup: string, options: { runScripts: 'outside-only'; url: string }) => { window: PhoneWindow };
};
const openRooms: Array<{ window: PhoneWindow }> = [];
const roomIntervals: Array<Array<() => void>> = [];
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, json: async () => body });
type FetchMock = Mock<(url: string, options?: RequestInit) => Promise<ReturnType<typeof reply>>>;
const snapshot = { playing: false, current: null, queue: [], position: 0, dictionary: {} };
const openPhone = (url: string, fetcher: FetchMock) => {
    const dom = new JSDOM(html, { runScripts: 'outside-only', url });
    dom.window.fetch = fetcher as unknown as typeof fetch;
    const callbacks: Array<() => void> = [];
    dom.window.setInterval = ((callback: TimerHandler) => { if (typeof callback === 'function') callbacks.push(callback as () => void); return 1; }) as typeof dom.window.setInterval;
    roomIntervals.push(callbacks);
    openRooms.push(dom);
    dom.window.eval(script);
    return dom;
};

afterEach(() => {
    openRooms.splice(0).forEach(room => room.window.close());
    roomIntervals.length = 0;
});

describe('KTV phone QR invitation', () => {
    it.each([
        ['the query credential used by new QR codes', 'http://192.168.1.20:5420/?token=query-invite', 'query-invite'],
        ['the fragment credential used by older QR codes', 'http://192.168.1.20:5420/#token=fragment-invite', 'fragment-invite'],
    ])('joins with %s and remembers credentials for reconnects', async (_description, url, token) => {
        const fetcher = vi.fn<(url: string, options?: RequestInit) => Promise<ReturnType<typeof reply>>>(async () => reply(200, { ok: true, data: { sessionId: 'phone-session', snapshot } }));
        const dom = openPhone(url, fetcher);

        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(dom.window.location.href).toBe('http://192.168.1.20:5420/'));
        expect(fetcher.mock.calls[0][0]).toBe('/api/join');
        expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ token });
        expect(dom.window.sessionStorage.getItem('folia-ktv-session')).toBe('phone-session');
        expect(dom.window.sessionStorage.getItem('folia-ktv-invite')).toBe(token);
    });

    it('rejoins with the saved invitation when a previous phone session expires', async () => {
        const responses = [
            reply(200, { ok: true, data: { sessionId: 'first-session', snapshot } }),
            reply(401, { ok: false, error: 'roomClosed' }),
            reply(200, { ok: true, data: { sessionId: 'renewed-session', snapshot } }),
        ];
        const fetcher = vi.fn<(url: string, options?: RequestInit) => Promise<ReturnType<typeof reply>>>(async () => responses.shift()!);
        const dom = openPhone('http://192.168.1.20:5420/?token=saved-invite', fetcher);

        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(dom.window.sessionStorage.getItem('folia-ktv-session')).toBe('first-session'));
        // The page's periodic refresh detects the expired session and uses the saved QR invite again.
        expect(roomIntervals[0]).toHaveLength(1);
        roomIntervals[0][0]();
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
        expect(fetcher.mock.calls[1][0]).toBe('/api/snapshot');
        expect(fetcher.mock.calls[2][0]).toBe('/api/join');
        expect(JSON.parse(fetcher.mock.calls[2][1]?.body as string)).toEqual({ token: 'saved-invite' });
        await vi.waitFor(() => expect(dom.window.sessionStorage.getItem('folia-ktv-session')).toBe('renewed-session'));
    });

    it('shows shared playback and KTV state and sends all controls through the authorized room session', async () => {
        const currentSnapshot = {
            ...snapshot,
            current: { id: 'current-song', title: '当前歌曲', artist: '歌手', duration: 210, source: '网易云' },
            queue: [], playing: true, mode: 'original', enabled: false, audibleMode: 'original',
            engine: null, preparation: 'idle', progress: 0, readySeconds: 0, position: 20, external: false,
        };
        const controls: Array<Record<string, unknown>> = [];
        const fetcher = vi.fn<(url: string, options?: RequestInit) => Promise<ReturnType<typeof reply>>>(async (url, options) => {
            if (url === '/api/join') return reply(200, { ok: true, data: { sessionId: 'phone-session', snapshot: currentSnapshot } });
            if (url === '/api/control') {
                const body = JSON.parse(options?.body as string) as Record<string, unknown>;
                controls.push(body);
                if (body.action === 'togglePlayback') currentSnapshot.playing = !currentSnapshot.playing;
                if (body.action === 'setMode') {
                    currentSnapshot.mode = body.value as string;
                    if (body.value === 'instrumental') currentSnapshot.enabled = true;
                }
                if (body.action === 'setEnabled') {
                    currentSnapshot.enabled = body.value as boolean;
                    if (!currentSnapshot.enabled) currentSnapshot.mode = 'original';
                }
                if (body.action === 'setMode' && body.value === 'instrumental') currentSnapshot.preparation = 'failed';
                if (body.action === 'retry') currentSnapshot.preparation = 'loading';
                return reply(200, { ok: true, data: { controlled: true } });
            }
            return reply(200, { ok: true, data: currentSnapshot });
        });
        const dom = openPhone('http://192.168.1.20:5420/?token=control-invite', fetcher);
        await vi.waitFor(() => {
            expect(dom.window.document.querySelector('#now-title')?.textContent).toBe('当前歌曲');
            expect((dom.window.document.querySelector('#previous-button') as HTMLButtonElement)?.disabled).toBe(false);
        });
        const doc = dom.window.document;
        expect((doc.querySelector('#previous-button') as HTMLButtonElement)?.disabled).toBe(false);
        expect((doc.querySelector('#next-button') as HTMLButtonElement)?.disabled).toBe(false);
        expect(doc.querySelector('#play-toggle')?.getAttribute('aria-label')).toBe('暂停');
        expect(doc.querySelector('#mode-original')?.getAttribute('aria-pressed')).toBe('true');
        expect(doc.querySelector('#accompaniment-status')?.textContent).toBe('伴奏生成未开启');

        const clickAndWait = async (selector: string) => {
            const before = controls.length;
            doc.querySelector(selector)!.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
            await vi.waitFor(() => expect(controls).toHaveLength(before + 1));
            await vi.waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url === '/api/snapshot').length).toBeGreaterThanOrEqual(before + 1));
        };
        await clickAndWait('#previous-button');
        await clickAndWait('#play-toggle');
        expect(doc.querySelector('#play-toggle')?.getAttribute('aria-label')).toBe('播放');
        await clickAndWait('#next-button');
        await clickAndWait('#mode-instrumental');
        expect(doc.querySelector('#mode-instrumental')?.getAttribute('aria-pressed')).toBe('true');
        expect(doc.querySelector('#accompaniment-toggle')?.getAttribute('aria-checked')).toBe('true');
        expect((doc.querySelector('#retry-accompaniment') as HTMLButtonElement)?.hidden).toBe(false);
        await clickAndWait('#retry-accompaniment');
        expect(doc.querySelector('#accompaniment-status')?.textContent).toBe('正在读取音频并准备模型…');
        expect((doc.querySelector('#retry-accompaniment') as HTMLButtonElement)?.hidden).toBe(true);
        await clickAndWait('#accompaniment-toggle');
        expect(doc.querySelector('#accompaniment-toggle')?.getAttribute('aria-checked')).toBe('false');
        await clickAndWait('#mode-original');
        expect(controls.map(control => control.action)).toEqual([
            'previous', 'togglePlayback', 'next', 'setMode', 'retry', 'setEnabled', 'setMode',
        ]);
        expect(controls[3]).toMatchObject({ action: 'setMode', value: 'instrumental' });
        expect(controls[5]).toMatchObject({ action: 'setEnabled', value: false });
        expect(fetcher.mock.calls.filter(([url]) => url === '/api/control').every(([, options]) => options?.headers && (options.headers as Record<string, string>).Authorization === 'Bearer phone-session')).toBe(true);
    });
});
