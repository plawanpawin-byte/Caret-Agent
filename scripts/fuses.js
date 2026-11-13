'use strict';
// After electron-builder packs the app, switch off the Electron features this app does not use, so the
// installed program cannot be bent into something else (a debugger, an unrelated Node script, a file:// page).
// RunAsNode stays on: Caret Agent starts its own helper scripts with it (the approval bridge and the CLI launcher).
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(ctx) {
  const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe');
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
};
