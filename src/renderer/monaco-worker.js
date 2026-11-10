// Monaco runs language features in a worker. A real file (not a blob)
// keeps the page's content-security-policy strict.
self.MonacoEnvironment = { baseUrl: 'caret://app/monaco/' };
importScripts('caret://app/monaco/vs/base/worker/workerMain.js');
