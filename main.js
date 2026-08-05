const { app, BrowserWindow, dialog, Menu } = require('electron');
const path = require('path');

// Fängt Abstürze beim Laden von server.js ab und zeigt sie an
process.on('uncaughtException', (error) => {
    dialog.showErrorBox('Schwerwiegender Fehler beim Start', error.stack || error.message);
});

try {
    // Server einbinden
    require(path.join(__dirname, 'server.js'));
} catch (err) {
    dialog.showErrorBox('Fehler beim Laden von server.js', err.stack || err.message);
}

function createWindow() {
    // Menüleiste (File, Edit, View...) global entfernen
    Menu.setApplicationMenu(null);

    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        title: 'AniWorld Watchlist',
        icon: path.join(__dirname, 'icon.ico'), // <--- Hier ist dein Icon eingebunden
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Kurz warten, bis der Express-Server bereit ist
    setTimeout(() => {
        win.loadURL('http://localhost:3000');
    }, 1500);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});