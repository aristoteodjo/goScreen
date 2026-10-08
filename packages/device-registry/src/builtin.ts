import ipadAir13 from "./devices/apple/ipad-air-13.json";
import ipadMini from "./devices/apple/ipad-mini.json";
import ipadPro11 from "./devices/apple/ipad-pro-11.json";
import iphone16e from "./devices/apple/iphone-16e.json";
import iphone17 from "./devices/apple/iphone-17.json";
import iphone17Pro from "./devices/apple/iphone-17-pro.json";
import iphone17ProMax from "./devices/apple/iphone-17-pro-max.json";
import iphoneAir from "./devices/apple/iphone-air.json";
import imac24 from "./devices/desktop/imac-24.json";
import macbookAir13 from "./devices/desktop/macbook-air-13.json";
import macbookPro16 from "./devices/desktop/macbook-pro-16.json";
import monitor from "./devices/desktop/monitor.json";
import windowsLaptop from "./devices/desktop/windows-laptop.json";
import android from "./devices/generic/android.json";
import pixel9a from "./devices/google/pixel-9a.json";
import pixel10 from "./devices/google/pixel-10.json";
import pixel10ProXl from "./devices/google/pixel-10-pro-xl.json";
import galaxyS25 from "./devices/samsung/galaxy-s25.json";
import galaxyS25Ultra from "./devices/samsung/galaxy-s25-ultra.json";
import galaxyTabS10 from "./devices/samsung/galaxy-tab-s10.json";
import { type DevicePack, parseDevicePack } from "./registry";

export const builtinPack: DevicePack = parseDevicePack({
  metadata: {
    id: "builtin",
    name: "Builtin devices",
    version: "1.0.0",
    builtin: true,
  },
  devices: [
    ipadAir13,
    ipadMini,
    ipadPro11,
    iphone16e,
    iphone17ProMax,
    iphone17Pro,
    iphone17,
    iphoneAir,
    imac24,
    macbookAir13,
    macbookPro16,
    monitor,
    windowsLaptop,
    android,
    pixel10ProXl,
    pixel10,
    pixel9a,
    galaxyS25Ultra,
    galaxyS25,
    galaxyTabS10,
  ],
});
