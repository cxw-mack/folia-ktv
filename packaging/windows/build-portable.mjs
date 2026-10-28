import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds desktop assets and a complete Windows directory, then archives it for unpack-and-run use.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this target on Windows x64');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const name = `Folia-KTV-${version}-Windows-x64-LanAccess-20261028c`;
const release = path.join(root, 'release');
const folder = path.join(release, name);
const archive = path.join(release, `${name}.zip`);
if (existsSync(folder) || existsSync(archive)) throw new Error(`Release already exists: ${name}`);

function run(executable, args, env = process.env) {
    const result = spawnSync(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${executable} exited with ${result.status}`);
}

const env = { ...process.env, ELECTRON: 'true', ELECTRON_DEV: 'false' };
delete env.ELECTRON_RUN_AS_NODE;
run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], env);
run(process.execPath, [path.join(root, 'node_modules/electron-builder/out/cli/cli.js'), '--win', 'dir', '--x64', '--config', 'packaging/windows/portable.config.cjs', '--publish', 'never'], env);

await rename(path.join(release, 'portable-build', 'win-unpacked'), folder);
if (!existsSync(path.join(folder, 'Folia-KTV.exe'))) throw new Error('Packaged Folia-KTV.exe is missing');
await copyFile(path.join(root, 'packaging/windows/README-PORTABLE.txt'), path.join(folder, 'README-KTV.txt'));
await copyFile(path.join(root, 'LICENSE'), path.join(folder, 'LICENSE-Folia.txt'));
await copyFile(path.join(root, 'shared/modelManifest.json'), path.join(folder, 'resources/modelManifest.json'));
await mkdir(path.join(folder, 'data'), { recursive: true });

const zipScript = path.join(root, 'packaging/windows/createPortableZip.ps1');
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const zipResult = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', zipScript, folder, archive], {
    cwd: root, stdio: 'inherit', windowsHide: true,
});
if (zipResult.error) throw zipResult.error;
if (zipResult.status !== 0) throw new Error(`ZIP creation failed with ${zipResult.status}`);

async function sha256(file) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}
await writeFile(`${archive}.sha256`, `${await sha256(archive)}  ${path.basename(archive)}\n`);
console.log(`[Portable] Ready: ${archive}`);
