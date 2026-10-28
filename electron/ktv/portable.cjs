const fs = require('node:fs');
const path = require('node:path');

// Keeps the Windows KTV portable build's settings and Chromium profile beside the executable.
function configureKtvPortable({ app, enabled }) {
    if (!enabled) return false;
    const explicitProfile = app.commandLine.getSwitchValue('user-data-dir');
    const userData = explicitProfile || path.join(path.dirname(app.getPath('exe')), 'data');
    const sessionData = path.join(userData, 'session');
    fs.mkdirSync(sessionData, { recursive: true });
    app.setPath('userData', userData);
    app.setPath('sessionData', sessionData);
    return true;
}

module.exports = { configureKtvPortable };
