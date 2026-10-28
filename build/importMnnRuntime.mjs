import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// Imports a deliberately selected native runtime after checking its checksum, machine type and ABI.
export async function importMnnRuntime({ file, sha256, outDir, platform, arch }) {
    if (platform !== 'win32' || arch !== 'x64') {
        throw new Error('Prebuilt MNN import currently supports Windows x64 only');
    }
    if (!/^[a-f0-9]{64}$/i.test(sha256 || '')) {
        throw new Error('FOLIA_MNN_PREBUILT_SHA256 must contain the selected library SHA-256');
    }
    const bytes = await readFile(file);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== sha256.toLowerCase()) throw new Error(`MNN checksum mismatch: ${actual}`);
    const peOffset = bytes.length >= 64 ? bytes.readUInt32LE(60) : -1;
    if (peOffset < 0 || peOffset + 6 > bytes.length || bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0' || bytes.readUInt16LE(peOffset + 4) !== 0x8664) {
        throw new Error('Selected MNN library is not a Windows x64 PE binary');
    }
    const require = createRequire(import.meta.url);
    const library = require('koffi').load(path.resolve(file));
    let isa;
    try {
        const abi = library.func('int folia_mnn_abi()')();
        if (abi !== 2) throw new Error(`Selected MNN ABI is ${abi}; this app requires 2`);
        isa = library.func('const char* folia_mnn_isa()')();
    } finally {
        library.unload();
    }
    await mkdir(outDir, { recursive: true });
    const target = path.join(outDir, 'folia_mnn.dll');
    if (path.resolve(file).toLowerCase() !== path.resolve(target).toLowerCase()) await copyFile(file, target);
    // An imported binary must never impersonate a build made from this checkout's pinned sources.
    await rm(path.join(outDir, 'BUILD-INFO.txt'), { force: true });
    await writeFile(path.join(outDir, 'PREBUILT-INFO.json'), JSON.stringify({
        source: path.basename(file), sha256: actual, abi: 2, platform, arch, validatedIsa: isa,
    }, null, 2) + '\n');
    console.log(`[mnn] Imported Windows x64 runtime, ABI 2, SHA-256 ${actual}`);
    return outDir;
}
