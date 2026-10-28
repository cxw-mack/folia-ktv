const { build } = require('../../package.json');

// Builds a ZIP-friendly directory, so launching KTV never requires extracting a one-file installer.
module.exports = {
    ...build,
    productName: 'Folia KTV',
    executableName: 'Folia-KTV',
    directories: { ...build.directories, output: 'release/portable-build' },
    extraMetadata: { foliaKtvPortable: true },
    publish: null,
    files: [...build.files, 'LICENSE'],
    extraResources: [
        ...build.extraResources,
        { from: 'build/mnn/win-x64/PREBUILT-INFO.json', to: 'mnn/PREBUILT-INFO.json' },
    ],
    win: {
        ...build.win,
        executableName: 'Folia-KTV',
        // This release is unsigned. Skip resource editing too, so a clean build does not need
        // electron-builder's remote Windows signing helper; the app still carries every runtime file.
        signAndEditExecutable: false,
        signExecutable: false,
        target: [{ target: 'dir', arch: ['x64'] }],
    },
};
