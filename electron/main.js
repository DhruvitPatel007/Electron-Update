const { app, BrowserWindow, ipcMain, session, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const loudness = require("loudness");
const { autoUpdater } = require("electron-updater");

let bluetoothPinCallback = null;
let selectBluetoothCallback = null;
let cachedDeviceToSelect = null;

if (process.env.NODE_ENV === "development") {
  try {
    require("electron-reload")(path.join(__dirname, ".."), {
      electron: path.join(__dirname, "..", "node_modules", ".bin", "electron"),
      awaitWriteFinish: true,
    });
  } catch (e) {
    console.log("Auto-reload failed:", e);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    autoHideMenuBar: true,
    frame: true,
    icon: path.join(__dirname, "..", "public", "ims.jpg"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.maximize();

  ipcMain.on("bluetooth-pairing-response", (event, response) => {
    if (bluetoothPinCallback) bluetoothPinCallback(response);
  });

  session.defaultSession.setBluetoothPairingHandler((details, callback) => {
    bluetoothPinCallback = callback;
    console.log("Bluetooth pairing request from system:", details);
    win.webContents.send("bluetooth-pairing-request", details);
  });

  win.webContents.on(
    "select-bluetooth-device",
    (event, deviceList, callback) => {
      event.preventDefault();
      console.log("Bluetooth scan started. Devices found:", deviceList.length);

      const targetId = cachedDeviceToSelect;
      const foundDevice = deviceList.find(
        (d) => targetId && d.deviceId.toUpperCase() === targetId.toUpperCase(),
      );

      if (foundDevice) {
        console.log("Auto-selecting found device:", foundDevice.deviceId);
        callback(foundDevice.deviceId);
        cachedDeviceToSelect = null;
        selectBluetoothCallback = null;
      } else {
        console.log("Target not found yet. Showing picker list...");
        selectBluetoothCallback = callback;
        win.webContents.send("bluetooth-device-list", deviceList);
      }
    },
  );

  ipcMain.on("bluetooth-device-selected", (event, deviceId) => {
    console.log("React requested device:", deviceId);

    if (selectBluetoothCallback) {
      console.log("Scan active. Selecting now.");
      selectBluetoothCallback(deviceId);
      selectBluetoothCallback = null;
      cachedDeviceToSelect = null;
    } else {
      console.log("Scan not active. Caching ID for later.");
      cachedDeviceToSelect = deviceId;
    }
  });

  ipcMain.on("cancel-bluetooth-request", () => {
    console.log("User cancelled Bluetooth request");
    if (selectBluetoothCallback) {
      selectBluetoothCallback("");
      selectBluetoothCallback = null;
    }
    cachedDeviceToSelect = null;
  });

  ipcMain.handle("get-system-volume", async () => {
    try {
      const volume = await loudness.getVolume();
      const isMuted = await loudness.getMuted();
      return {
        volume,
        muted: isMuted,
      };
    } catch (err) {
      console.error("Volume fetch failed:", err);
      return null;
    }
  });

  if (process.env.NODE_ENV !== "development") {
    const buildIndexPath = path.join(__dirname, "..", "build", "index.html");
    const rootIndexPath = path.join(__dirname, "..", "index.html");

    // Load React build output when present, otherwise use the local HTML entry.
    const rendererPath = fs.existsSync(buildIndexPath)
      ? buildIndexPath
      : rootIndexPath;

    win.loadFile(rendererPath);
    console.log("Loading renderer from:", rendererPath);
  } else {
    win.loadURL("http://localhost:3000");
    win.webContents.openDevTools();
    console.log("Loading development server: http://localhost:3000");
  }

  win.once("ready-to-show", () => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  });
}

autoUpdater.on("checking-for-update", () => {
  console.log("Checking for update...");
});

autoUpdater.on("update-available", (info) => {
  console.log("Update available:", info.version);
});

autoUpdater.on("update-not-available", (info) => {
  console.log(
    "No update available. Current/latest:",
    app.getVersion(),
    info.version,
  );
});

autoUpdater.on("download-progress", (progressObj) => {
  console.log(
    `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent.toFixed(1)}%`,
  );
});

autoUpdater.on("update-downloaded", () => {
  console.log("Update downloaded.");
  dialog
    .showMessageBox({
      type: "info",
      title: "Update Ready",
      message:
        "A new version has been downloaded. Restart the application to apply the updates.",
      buttons: ["Restart", "Later"],
    })
    .then((returnValue) => {
      if (returnValue.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
});

autoUpdater.on("error", (err) => {
  console.error(
    "Error in auto-updater:",
    err == null ? "unknown" : err.message,
  );
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
