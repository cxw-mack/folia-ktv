const path = require('path');
const { pathToFileURL } = require('url');

// Shows a local KTV startup window while the main process and the first React screen prepare.
function createKtvStartup({ app, BrowserWindow, iconPath }) {
    let splash = null;
    let finishing = false;

    const show = () => new Promise(resolve => {
        let win;
        try {
            win = new BrowserWindow({
                width: 420,
                height: 320,
                title: 'Folia KTV',
                frame: false,
                resizable: false,
                maximizable: false,
                backgroundColor: '#09090b',
                icon: iconPath,
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: true,
                },
            });
        } catch (error) {
            finishing = true;
            console.warn('[KtvStartup] Startup window could not be created; continuing without it', error);
            resolve();
            return;
        }
        splash = win;
        const abandon = (reason) => {
            if (splash !== win || finishing) return;
            console.warn('[KtvStartup] Startup screen failed; continuing without it', reason);
            finishing = true;
            if (!win.isDestroyed()) win.destroy();
            resolve();
        };
        win.once('ready-to-show', () => {
            if (!finishing && !win.isDestroyed()) win.show();
            resolve();
        });
        win.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (isMainFrame) abandon(new Error(`load failed (${errorCode}): ${errorDescription} (${validatedURL})`));
        });
        win.webContents.once('render-process-gone', (_event, details) => {
            abandon(new Error(`renderer exited: ${details?.reason || 'unknown reason'}`));
        });
        win.once('closed', () => {
            if (splash === win) splash = null;
            resolve();
            if (!finishing) app.quit();
        });
        void win.loadFile(path.join(__dirname, 'startup.html'), {
            query: { icon: pathToFileURL(iconPath).href },
        }).catch(error => {
            abandon(error);
        });
    });

    const finish = mainWindow => {
        if (!splash || splash.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) return;
        finishing = true;
        if (mainWindow.__startupMaximize) {
            mainWindow.__startupMaximize = false;
            mainWindow.maximize();
        }
        mainWindow.show();
        mainWindow.focus();
        splash.destroy();
        splash = null;
    };

    app.once('before-quit', () => { finishing = true; });
    return { show, finish, isActive: () => Boolean(splash && !splash.isDestroyed()) };
}

module.exports = { createKtvStartup };
