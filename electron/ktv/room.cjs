const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const QRCode = require('qrcode');

// An opt-in LAN room. Only opaque search results cross back into desktop queue actions.
const ROOM_TTL = 6 * 60 * 60_000;
const SESSION_TTL = 90_000;
const REQUEST_TTL = 25_000;
const controlActions = new Set(['previous', 'next', 'togglePlayback', 'setMode', 'setEnabled', 'retry']);
const randomId = () => crypto.randomBytes(24).toString('base64url');
const assets = new Map([
    ['/', ['mobile.html', 'text/html; charset=utf-8']],
    ['/mobile.js', ['mobile.js', 'text/javascript; charset=utf-8']],
    ['/mobile.css', ['mobile.css', 'text/css; charset=utf-8']],
]);
const fail = (status, code) => Object.assign(new Error(code), { status, code });

function createKtvRoom({ onRequest, now = Date.now, interfaces = os.networkInterfaces, requestTimeout = REQUEST_TTL }) {
    let server = null;
    let lifecycle = Promise.resolve();
    let epoch = 0;
    let token = '';
    let generation = '';
    let expiresAt = 0;
    let invites = [];
    let snapshot = null;
    let expiryTimer = null;
    const sessions = new Map();
    const pending = new Map();
    const operations = new Map();
    const joinRates = new Map();
    const hosts = new Set();

    const live = () => Boolean(server?.listening && expiresAt > now());
    const prune = () => {
        for (const [id, session] of sessions) if (session.seen + SESSION_TTL < now()) sessions.delete(id);
        for (const [id, operation] of operations) if (operation.until < now()) operations.delete(id);
    };
    const status = () => {
        prune();
        return { running: live(), generation, invites: live() ? invites : [], expiresAt, sessions: sessions.size,
            localOnly: invites.every(invite => new URL(invite.url).hostname === '127.0.0.1') };
    };
    const cancelPending = () => {
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.resolve({ ok: false, error: 'roomClosed' });
        }
        pending.clear();
        operations.clear();
        sessions.clear();
        joinRates.clear();
    };
    const serialize = work => {
        const next = lifecycle.then(work, work);
        lifecycle = next.catch(() => undefined);
        return next;
    };
    const invalidate = () => {
        token = '';
        generation = '';
        expiresAt = 0;
        invites = [];
        snapshot = null;
        clearTimeout(expiryTimer);
        cancelPending();
    };
    const closeServer = async () => {
        const closing = server;
        server = null;
        if (closing) {
            await new Promise(resolve => {
                closing.close(resolve);
                closing.closeAllConnections();
            });
        }
    };
    // Stop invalidates requests immediately, including an opening listener or QR render in flight.
    const stop = () => {
        epoch += 1;
        invalidate();
        return serialize(async () => { await closeServer(); return status(); });
    };
    const rotate = async currentEpoch => {
        cancelPending();
        token = '';
        generation = '';
        expiresAt = 0;
        const nextToken = randomId();
        const port = server.address().port;
        const addresses = [...new Set(Object.values(interfaces()).flat().filter(entry => entry && !entry.internal
            && entry.family === 'IPv4' && !entry.address.startsWith('169.254.')).map(entry => entry.address))];
        if (!addresses.length) addresses.push('127.0.0.1');
        hosts.clear();
        [...addresses, '127.0.0.1', 'localhost'].forEach(address => hosts.add(`${address}:${port}`));
        const newInvites = [];
        for (const address of addresses) {
            const url = new URL('/', `http://${address}:${port}`);
            url.searchParams.set('token', nextToken);
            const inviteUrl = url.toString();
            newInvites.push({ url: inviteUrl, qr: await QRCode.toDataURL(inviteUrl, { width: 256, margin: 2, errorCorrectionLevel: 'M' }) });
        }
        if (currentEpoch !== epoch) return status();
        token = nextToken;
        generation = randomId();
        expiresAt = now() + ROOM_TTL;
        invites = newInvites;
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(() => { void stop(); }, ROOM_TTL);
        expiryTimer.unref();
        return status();
    };
    const json = (response, code, body) => {
        if (response.destroyed) return;
        response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(body));
    };
    const readBody = request => new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        request.on('data', chunk => {
            size += chunk.length;
            if (size > 4096) { reject(fail(413, 'invalidRequest')); request.resume(); }
            else chunks.push(chunk);
        });
        request.on('end', () => {
            if (size > 4096) return;
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(fail(400, 'invalidRequest')); }
        });
        request.on('error', reject);
    });
    const requestDesktop = (sessionId, action, payload) => {
        const requestId = randomId();
        const currentGeneration = generation;
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                pending.delete(requestId);
                resolve({ ok: false, error: 'timeout' });
            }, requestTimeout);
            pending.set(requestId, { resolve, timer, sessionId, generation: currentGeneration, action });
            try { onRequest({ requestId, generation: currentGeneration, sessionId, action, ...payload }); }
            catch {
                clearTimeout(timer);
                pending.delete(requestId);
                resolve({ ok: false, error: 'unavailable' });
            }
        });
    };
    const handle = async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        try {
            if (!hosts.has(request.headers.host)) throw fail(403, 'forbidden');
            const origin = request.headers.origin;
            if (origin && origin !== `http://${request.headers.host}`) throw fail(403, 'forbidden');
            const url = new URL(request.url, `http://${request.headers.host}`);
            const asset = assets.get(url.pathname);
            if (asset && request.method === 'GET') {
                response.writeHead(200, { 'Content-Type': asset[1] });
                response.end(fs.readFileSync(path.join(__dirname, asset[0])));
                return;
            }
            if (!live()) throw fail(410, 'roomClosed');
            const requestGeneration = generation;
            prune();
            if (url.pathname === '/api/join' && request.method === 'POST') {
                const ip = request.socket.remoteAddress || '';
                const rate = joinRates.get(ip);
                if (rate && rate.from + 60_000 > now() && rate.count >= 10) throw fail(429, 'rateLimited');
                if (!rate || rate.from + 60_000 <= now()) {
                    if (joinRates.size >= 128) joinRates.delete(joinRates.keys().next().value);
                    joinRates.set(ip, { from: now(), count: 1 });
                } else rate.count += 1;
                const body = await readBody(request);
                if (!live() || generation !== requestGeneration) throw fail(410, 'roomClosed');
                const supplied = typeof body?.token === 'string' ? body.token : '';
                const suppliedBytes = Buffer.from(supplied);
                const tokenBytes = Buffer.from(token);
                if (suppliedBytes.length !== tokenBytes.length || !crypto.timingSafeEqual(suppliedBytes, tokenBytes)) throw fail(401, 'roomClosed');
                if (sessions.size >= 32) throw fail(429, 'roomFull');
                const sessionId = randomId();
                sessions.set(sessionId, { seen: now(), searchAt: -Infinity, enqueueAt: -Infinity, controlAt: -Infinity });
                return json(response, 200, { ok: true, data: { sessionId, expiresAt, snapshot } });
            }
            const sessionId = (request.headers.authorization || '').replace(/^Bearer /, '');
            const session = sessions.get(sessionId);
            if (!session) throw fail(401, 'roomClosed');
            session.seen = now();
            if (url.pathname === '/api/snapshot' && request.method === 'GET') return json(response, 200, { ok: true, data: snapshot });
            const isRequest = url.pathname === '/api/request';
            const isControl = url.pathname === '/api/control';
            if ((!isRequest && !isControl) || request.method !== 'POST') throw fail(404, 'invalidRequest');
            if (!request.headers['content-type']?.startsWith('application/json')) throw fail(415, 'invalidRequest');
            const body = await readBody(request);
            if (!live() || generation !== requestGeneration || !sessions.has(sessionId)) throw fail(410, 'roomClosed');
            if (!body || (isRequest && !['search', 'enqueue'].includes(body.action)) || (isControl && !controlActions.has(body.action))) throw fail(400, 'invalidRequest');
            const action = body.action;
            const operationId = body.operationId;
            const desktopAction = isControl ? 'control' : action;
            if (action === 'enqueue' && (typeof operationId !== 'string' || !/^[\w-]{8,80}$/.test(operationId))) throw fail(400, 'invalidRequest');
            if (action === 'setMode' && !['original', 'instrumental'].includes(body.value)) throw fail(400, 'invalidRequest');
            if (action === 'setEnabled' && typeof body.value !== 'boolean') throw fail(400, 'invalidRequest');
            const operationKey = `${sessionId}:${operationId}`;
            if (action === 'enqueue' && operations.has(operationKey)) return json(response, 200, await operations.get(operationKey).reply);
            const field = isControl ? 'controlAt' : `${action}At`;
            if (session[field] + 750 > now() || [...pending.values()].some(entry => entry.sessionId === sessionId && entry.action === desktopAction)) throw fail(429, 'rateLimited');
            if (pending.size >= 48) throw fail(429, 'rateLimited');
            let payload;
            if (action === 'search') {
                if (typeof body.query !== 'string' || body.query.trim().length < 1 || body.query.length > 80) throw fail(400, 'invalidRequest');
                payload = { query: body.query.trim(), source: body.source === 'local' ? 'local' : 'online' };
            } else if (action === 'enqueue') {
                if (typeof body.resultId !== 'string' || !/^[\w-]{10,80}$/.test(body.resultId)) throw fail(400, 'invalidRequest');
                payload = { resultId: body.resultId, operationId };
            } else {
                payload = { control: action, ...(action === 'setMode' || action === 'setEnabled' ? { value: body.value } : {}) };
            }
            session[field] = now();
            const reply = requestDesktop(sessionId, desktopAction, payload);
            if (action === 'enqueue') {
                if (operations.size >= 512) operations.delete(operations.keys().next().value);
                operations.set(operationKey, { reply, until: now() + 10 * 60_000 });
            }
            return json(response, 200, await reply);
        } catch (error) {
            json(response, error.status || 500, { ok: false, error: error.code || 'unavailable' });
        }
    };
    const open = async currentEpoch => {
        if (currentEpoch !== epoch) return status();
        if (live()) return status();
        await closeServer();
        if (currentEpoch !== epoch) return status();
        const opening = http.createServer((request, response) => { void handle(request, response); });
        opening.requestTimeout = 30_000;
        opening.headersTimeout = 10_000;
        opening.maxConnections = 64;
        await new Promise((resolve, reject) => { opening.once('error', reject); opening.listen(0, '0.0.0.0', resolve); });
        server = opening;
        if (currentEpoch !== epoch) { await closeServer(); return status(); }
        opening.on('error', error => console.error('[KTV] room server failed', error));
        console.info('[KTV] LAN room opened');
        return rotate(currentEpoch);
    };
    const start = () => {
        const currentEpoch = epoch;
        return serialize(() => open(currentEpoch));
    };
    const renew = () => {
        const currentEpoch = epoch;
        return serialize(() => currentEpoch !== epoch ? status() : server?.listening ? rotate(currentEpoch) : open(currentEpoch));
    };
    return {
        start, stop, renew, status,
        publish: value => { if (live() && value && JSON.stringify(value).length <= 256 * 1024) snapshot = value; },
        isPending: (requestId, requestGeneration) => live() && requestGeneration === generation && pending.has(requestId),
        complete: reply => {
            const entry = pending.get(reply?.requestId);
            if (!entry || entry.generation !== generation || reply.generation !== generation || !live()) return;
            clearTimeout(entry.timer);
            pending.delete(reply.requestId);
            entry.resolve({ ok: reply.ok === true, ...(reply.ok ? { data: reply.data } : { error: reply.error || 'unavailable' }) });
        },
    };
}

module.exports = { createKtvRoom };
