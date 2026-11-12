'use strict';
// The only bridge between the page and the system. The page gets named
// functions — never ipcRenderer itself, Node, or the file system.
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const listen = (ch) => (fn) => {
  const h = (_e, payload) => fn(payload);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('caret', {
  settings: { get: call('settings:get'), update: call('settings:update'), setKey: call('settings:setKey') },
  app: { info: call('app:info'), openExternal: call('app:openExternal'), checkUpdate: call('app:checkUpdate'), preview: call('app:preview') },
  workspace: {
    pick: call('workspace:pick'), openRecent: call('workspace:openRecent'), clone: call('workspace:clone'),
    current: call('workspace:current'), close: call('workspace:close'),
  },
  fs: {
    list: call('fs:list'), read: call('fs:read'), readImage: call('fs:readImage'), write: call('fs:write'), create: call('fs:create'),
    rename: call('fs:rename'), remove: call('fs:delete'), search: call('fs:search'), reveal: call('fs:reveal'),
    onChanged: listen('fs:changed'),
  },
  term: {
    create: call('term:create'), list: call('term:list'), run: call('term:run'), kill: call('term:kill'), close: call('term:close'),
    onData: listen('term:data'), onExit: listen('term:exit'), onCreated: listen('term:created'), onClosed: listen('term:closed'), onUrl: listen('term:url'),
  },
  providers: { status: call('providers:status'), install: call('providers:install'), signIn: call('providers:signIn'), onProgress: listen('providers:progress') },
  models: { catalog: call('models:catalog'), hardware: call('models:hardware') },
  agent: {
    list: call('agent:list'), get: call('agent:get'), create: call('agent:new'), rename: call('agent:rename'), remove: call('agent:delete'),
    send: call('agent:send'), stop: call('agent:stop'), approve: call('agent:approve'), onEvent: listen('agent:event'),
  },
});
