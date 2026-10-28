import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

// Opens an isolated KTV room and waits for a real phone to join through its QR code.
const executable = path.resolve(process.argv[2]);
const waitSeconds = Math.max(30, Math.min(300, Number(process.argv[3]) || 120));
if (!fs.existsSync(executable)) throw new Error(`Folia executable not found: ${executable}`);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-ktv-phone-probe-'));
const probe = net.createServer();
await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
});
const debugPort = probe.address().port;
await new Promise(resolve => probe.close(resolve));

let app;
let child;
let page;
try {
    child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`], {
        cwd: path.dirname(executable),
        env: { ...process.env, ELECTRON_DEV: 'false' },
        windowsHide: false,
        stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.once('error', error => { throw error; });

    const deadline = Date.now() + 120_000;
    while (!page && Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Folia exited before its window appeared (${child.exitCode})`);
        if (!app) try {
            app = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1000 });
        } catch {}
        page = app?.contexts().flatMap(context => context.pages()).find(candidate => !candidate.url().includes('startup.html'));
        if (!page) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!page) throw new Error('Folia main window did not appear');
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), null, { timeout: 120_000 });
    await page.getByRole('button', { name: '打开 KTV 控制台', exact: true }).click();
    const openRoom = page.getByRole('button', { name: '开启扫码点歌', exact: true });
    await openRoom.waitFor({ state: 'visible', timeout: 30_000 });
    await openRoom.click();
    const qr = page.getByRole('img', { name: '扫描二维码进入手机点歌房', exact: true });
    await qr.waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByText(/电脑局域网地址：http:\/\//).waitFor({ state: 'visible', timeout: 30_000 });

    const status = await page.evaluate(() => window.electron.ktvRoom.status());
    if (!status.running || status.invites.length === 0) throw new Error('KTV room did not start');
    const origin = new URL(status.invites[0].url).origin;
    const authorization = await page.evaluate(() => window.electron.ktvRoom.authorizeLan());
    if (!authorization.allowed) throw new Error(`Firewall rule not ready: ${authorization.detail || authorization.reason}`);

    console.log(JSON.stringify({ ready: true, address: origin, phoneSessions: status.sessions, waitSeconds }));
    console.log('Use the iPhone Camera app to scan the visible QR code now. The room will remain open while this probe waits.');

    const until = Date.now() + waitSeconds * 1000;
    let sessions = status.sessions;
    while (Date.now() < until && sessions === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        sessions = (await page.evaluate(() => window.electron.ktvRoom.status())).sessions;
    }
    const screenshot = path.resolve('test-results/ktv-phone-live-probe.png');
    await page.screenshot({ path: screenshot });
    console.log(JSON.stringify({ phoneConnected: sessions > 0, phoneSessions: sessions, address: origin, screenshot }));
    if (sessions === 0) process.exitCode = 3;
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    try { if (page && !page.isClosed()) await page.evaluate(() => window.electron.ktvRoom.stop()); } catch {}
    try { await app?.close(); } catch {}
    if (child && child.exitCode === null) {
        child.kill();
        await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(profile, { recursive: true, force: true });
}
