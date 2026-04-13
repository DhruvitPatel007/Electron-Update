const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("api", {
  appVersion:
    process.env.npm_package_version || require("../package.json").version,
});
