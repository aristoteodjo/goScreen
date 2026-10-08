import ipadPro11 from "./devices/apple/ipad-pro-11.json";
import iphone17 from "./devices/apple/iphone-17.json";
import iphone17Pro from "./devices/apple/iphone-17-pro.json";
import genericAndroid from "./devices/generic/android.json";
import pixel10 from "./devices/google/pixel-10.json";
import galaxyS25 from "./devices/samsung/galaxy-s25.json";
import { type DevicePack, parseDevicePack } from "./registry";

export const builtinPack: DevicePack = parseDevicePack({
  metadata: {
    id: "builtin",
    name: "Builtin devices",
    version: "1.0.0",
    builtin: true,
  },
  devices: [
    iphone17Pro,
    iphone17,
    ipadPro11,
    pixel10,
    galaxyS25,
    genericAndroid,
  ],
});
