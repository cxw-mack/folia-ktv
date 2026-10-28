import fs from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright-core';

const executable = path.resolve(process.argv[2]);
const packageRoot = path.dirname(executable);
const profile = path.join(packageRoot, 'smoke-data');
const screenshot = path.resolve(process.argv[3] || path.join('test-results', 'portable-smoke-main.png'));
const verifyFirewall = process.argv.includes('--verify-firewall');
fs.rmSync(profile, { recursive: true, force: true });
const startedAt = Date.now();
let app;
let child;
try {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
    });
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], {
        cwd: packageRoot,
        env: { ...process.env, ELECTRON_DEV: 'false' },
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => process.stdout.write(`[portable-main] ${data}`));
    child.stderr.on('data', data => process.stderr.write(`[portable-main:stderr] ${data}`));
    let browser;
    let main;
    const deadline = Date.now() + 120_000;
    while (!main && Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`portable EXE exited early: ${child.exitCode}`);
        if (!browser) try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
        } catch {}
        main = browser?.contexts().flatMap(context => context.pages()).find(page => !page.url().includes('startup.html'));
        if (main) break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!main) throw new Error(`main window did not appear; childExitCode=${child.exitCode}`);
    await main.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), null, { timeout: 120_000 });
    const firstPaint = await main.evaluate(() => ({
        title: document.title,
        url: location.href,
        rootChildren: document.getElementById('root')?.children.length ?? 0,
        splashVisible: Boolean(document.getElementById('app-splash')),
        startupDialogs: Array.from(document.querySelectorAll('[role="dialog"]')).filter(element => element.getAttribute('aria-modal') === 'true').length,
        bodyText: document.body.innerText.slice(0, 800),
    }));
    await main.waitForFunction(() => !document.getElementById('app-splash'), null, { timeout: 30_000 });
    if (firstPaint.startupDialogs !== 0) throw new Error(`first launch showed ${firstPaint.startupDialogs} blocking dialog(s)`);
    const ktvEntry = main.getByRole('button', { name: '打开 KTV 控制台', exact: true });
    if (!(await ktvEntry.count())) throw new Error(`KTV entry did not render; screenshot=${screenshot}`);
    await ktvEntry.first().click();
    const openRoom = main.getByRole('button', { name: '开启扫码点歌', exact: true });
    await openRoom.waitFor({ state: 'visible', timeout: 30_000 });
    await main.getByRole('button', { name: '手机打不开？修复局域网连接', exact: true })
        .waitFor({ state: 'visible', timeout: 30_000 });
    let firewallRuleVerified = false;
    if (verifyFirewall) {
        // Opt in only when this exact packaged EXE already has a firewall rule; otherwise Windows may show UAC.
        const authorization = await main.evaluate(() => window.electron.ktvRoom.authorizeLan());
        if (!authorization.allowed) throw new Error(`KTV firewall authorization check failed: ${authorization.detail || authorization.reason}`);
        firewallRuleVerified = true;
    }
    // Starting through IPC avoids changing Windows firewall settings in the default smoke run.
    await main.evaluate(() => window.electron.ktvRoom.start());
    await main.getByRole('img', { name: '扫描二维码进入手机点歌房', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await main.getByText(/电脑局域网地址：http:\/\//).waitFor({ state: 'visible', timeout: 30_000 });
    const room = await main.evaluate(async () => {
        const status = await window.electron.ktvRoom.status();
        return {
            running: status.running,
            localOnly: status.localOnly,
            invites: status.invites.map(({ url, qr }) => ({ url, hasQr: Boolean(qr) })),
        };
    });
    if (!room.running || room.invites.length === 0 || room.invites.some(invite => !invite.hasQr)) {
        throw new Error('KTV room did not return a working QR invitation');
    }
    const inviteUrl = new URL(room.invites[0].url);
    const visiblePhoneAddress = await main.getByText(/电脑局域网地址：http:\/\//).innerText();
    if (!/:[0-9]+/.test(inviteUrl.host) || !visiblePhoneAddress.includes(inviteUrl.host)) {
        throw new Error(`KTV panel did not show the full phone URL with its port: ${visiblePhoneAddress}`);
    }
    const mobilePage = await fetch(inviteUrl, { signal: AbortSignal.timeout(10_000) });
    const mobileHtml = await mobilePage.text();
    if (!mobilePage.ok || !mobileHtml.includes('id="phone-title"')) {
        throw new Error(`KTV phone page did not load (${mobilePage.status})`);
    }
    const joinResponse = await fetch(new URL('/api/join', inviteUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: inviteUrl.searchParams.get('token') }),
        signal: AbortSignal.timeout(10_000),
    });
    const joinResult = await joinResponse.json();
    const sessionId = joinResult?.data?.sessionId;
    if (!joinResponse.ok || !sessionId) throw new Error(`KTV phone join failed (${joinResponse.status})`);
    const snapshot = await fetch(new URL('/api/snapshot', inviteUrl), {
        headers: { authorization: `Bearer ${sessionId}` },
        signal: AbortSignal.timeout(10_000),
    });
    if (!snapshot.ok) throw new Error(`KTV phone snapshot failed (${snapshot.status})`);
    const control = async body => {
        // The LAN room deliberately rate limits control actions to prevent a pocket tap storm.
        // Keep this smoke path at the same cadence as the phone UI, which disables its controls
        // until the previous request and snapshot refresh have completed.
        await new Promise(resolve => setTimeout(resolve, 800));
        const response = await fetch(new URL('/api/control', inviteUrl), {
            method: 'POST',
            headers: { authorization: `Bearer ${sessionId}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`KTV phone control failed (${response.status})`);
        return response.json();
    };
    await control({ action: 'setMode', value: 'instrumental' });
    const accompaniment = await fetch(new URL('/api/snapshot', inviteUrl), {
        headers: { authorization: `Bearer ${sessionId}` },
        signal: AbortSignal.timeout(10_000),
    }).then(response => response.json());
    if (accompaniment?.data?.mode !== 'instrumental' || !accompaniment.data.enabled) {
        throw new Error('KTV phone could not select and enable accompaniment');
    }
    await control({ action: 'setEnabled', value: false });
    const original = await fetch(new URL('/api/snapshot', inviteUrl), {
        headers: { authorization: `Bearer ${sessionId}` },
        signal: AbortSignal.timeout(10_000),
    }).then(response => response.json());
    if (original?.data?.enabled || original.data.mode !== 'original') {
        throw new Error('KTV phone could not disable accompaniment and return to original vocals');
    }
    await main.screenshot({ path: screenshot });
    console.log(JSON.stringify({
        ok: true,
        elapsedMs: Date.now() - startedAt,
        firstPaint,
        splashRemoved: true,
        ktvControlsVisible: true,
        lanRepairActionVisible: true,
        firewallRuleVerified,
        fullPhoneUrlVisible: true,
        qrOrderingActionVisible: true,
        roomServerRunning: room.running,
        qrInvitations: room.invites.length,
        phoneAddressShowsPort: true,
        mobilePageServed: true,
        phoneSessionJoined: true,
        phoneSnapshotServed: true,
        phoneAccompanimentControls: true,
        profile,
        dataDirectoryCreated: fs.existsSync(profile),
        screenshot,
    }, null, 2));
    await main.evaluate(() => window.electron.ktvRoom.stop());
    await browser?.close();
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
} catch (error) {
    console.error(error);
    if (child && child.exitCode === null) child.kill();
    process.exitCode = 1;
}
