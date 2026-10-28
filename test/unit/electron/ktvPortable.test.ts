import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Checks that the portable build isolates its data and honours an explicit automation profile.
const { configureKtvPortable } = require('../../../electron/ktv/portable.cjs');
const temporaryDirectories: string[] = [];

afterEach(() => {
    temporaryDirectories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
});

function fakeApp(explicitProfile = '') {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'folia-portable-'));
    temporaryDirectories.push(directory);
    return {
        directory,
        app: {
            commandLine: { getSwitchValue: vi.fn(() => explicitProfile) },
            getPath: vi.fn(() => path.join(directory, 'Folia-KTV.exe')),
            setPath: vi.fn(),
        },
    };
}

describe('KTV portable profile', () => {
    it('stores settings and Chromium session in the executable directory', () => {
        const { app, directory } = fakeApp();
        expect(configureKtvPortable({ app, enabled: true })).toBe(true);
        expect(app.setPath).toHaveBeenCalledWith('userData', path.join(directory, 'data'));
        expect(app.setPath).toHaveBeenCalledWith('sessionData', path.join(directory, 'data', 'session'));
    });

    it('honours the isolated profile specified for packaged smoke tests', () => {
        const { app, directory } = fakeApp();
        const profile = path.join(directory, 'isolated');
        app.commandLine.getSwitchValue.mockReturnValue(profile);
        configureKtvPortable({ app, enabled: true });
        expect(app.setPath).toHaveBeenCalledWith('userData', profile);
        expect(app.setPath).toHaveBeenCalledWith('sessionData', path.join(profile, 'session'));
    });

    it('leaves existing non-portable profiles alone', () => {
        const { app } = fakeApp();
        expect(configureKtvPortable({ app, enabled: false })).toBe(false);
        expect(app.setPath).not.toHaveBeenCalled();
        expect(app.getPath).not.toHaveBeenCalled();
    });
});
