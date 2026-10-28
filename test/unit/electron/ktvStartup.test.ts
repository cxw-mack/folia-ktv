import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/ktvStartup.test.ts

const { createKtvStartup } = require('../../../electron/ktv/startup.cjs') as {
    createKtvStartup: (options: Record<string, unknown>) => {
        show: () => Promise<void>;
        finish: (mainWindow: FakeMainWindow) => void;
        isActive: () => boolean;
    };
};

class FakeWebContents extends EventEmitter {}

class FakeSplashWindow extends EventEmitter {
    static latest: FakeSplashWindow;

    readonly webContents = new FakeWebContents();

    destroyed = false;

    shown = false;

    loadedFile: string | null = null;

    loadedOptions: Record<string, unknown> | null = null;

    constructor(readonly options: Record<string, unknown>) {
        super();
        FakeSplashWindow.latest = this;
    }

    loadFile(file: string, options: Record<string, unknown>) {
        this.loadedFile = file;
        this.loadedOptions = options;
        return Promise.resolve();
    }

    isDestroyed() {
        return this.destroyed;
    }

    show() {
        this.shown = true;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.emit('closed');
    }
}

type FakeMainWindow = {
    __startupMaximize?: boolean;
    destroyed?: boolean;
    isDestroyed: () => boolean;
    maximize: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
};

function createStartup() {
    const app = new EventEmitter() as EventEmitter & { quit: ReturnType<typeof vi.fn> };
    app.quit = vi.fn();
    const startup = createKtvStartup({
        app,
        BrowserWindow: FakeSplashWindow,
        iconPath: 'C:/Folia/build/icon.png',
    });
    return { app, startup };
}

function createMainWindow(): FakeMainWindow {
    return {
        isDestroyed: () => false,
        maximize: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
    };
}

describe('KTV startup window', () => {
    it('shows a local splash and hands off to the ready main window', async () => {
        const { startup } = createStartup();
        const shown = startup.show();
        const splash = FakeSplashWindow.latest;

        expect(startup.isActive()).toBe(true);
        expect(splash.options.show).toBe(false);
        expect((splash.options.webPreferences as Record<string, unknown>).sandbox).toBe(true);
        expect(splash.loadedFile).toMatch(/[\\/]electron[\\/]ktv[\\/]startup\.html$/);
        expect(splash.loadedOptions).toMatchObject({ query: { icon: expect.stringMatching(/^file:/) } });

        splash.emit('ready-to-show');
        await shown;
        expect(splash.shown).toBe(true);

        const mainWindow = createMainWindow();
        mainWindow.__startupMaximize = true;
        startup.finish(mainWindow);

        expect(mainWindow.maximize).toHaveBeenCalledOnce();
        expect(mainWindow.show).toHaveBeenCalledOnce();
        expect(mainWindow.focus).toHaveBeenCalledOnce();
        expect(splash.destroyed).toBe(true);
        expect(startup.isActive()).toBe(false);
    });

    it('continues without a splash if its local page fails to load', async () => {
        const { app, startup } = createStartup();
        const shown = startup.show();
        const splash = FakeSplashWindow.latest;

        splash.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', splash.loadedFile, true);
        await shown;

        expect(splash.destroyed).toBe(true);
        expect(startup.isActive()).toBe(false);
        expect(app.quit).not.toHaveBeenCalled();
    });

    it('quits cleanly if the user closes the splash before the app is ready', async () => {
        const { app, startup } = createStartup();
        const shown = startup.show();
        FakeSplashWindow.latest.destroy();
        await shown;

        expect(app.quit).toHaveBeenCalledOnce();
        expect(startup.isActive()).toBe(false);
    });
});
