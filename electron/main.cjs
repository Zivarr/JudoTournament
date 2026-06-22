'use strict';

const { app, BrowserWindow, dialog } = require('electron');

let mainWindow;

app.whenReady().then(async () => {
  // Set data directory before importing the server so state.js picks it up at module-init time.
  process.env.JUDO_DATA_DIR = app.getPath('userData');

  const { startServer } = await import('../server.js');
  await startServer(3000);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Judo Tournament',
    webPreferences: { nodeIntegration: false }
  });

  mainWindow.loadURL('http://localhost:3000/setup');

  mainWindow.on('close', (e) => {
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Yes, close', 'Cancel'],
      defaultId: 1,
      title: 'Close Judo Tournament?',
      message: 'Are you sure you want to close?',
      detail: 'The server will stop and all connected devices will be disconnected.'
    });
    if (choice === 0) app.exit(0);
  });
});
