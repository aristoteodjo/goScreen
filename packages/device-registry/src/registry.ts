import {
  type DeviceDefinition,
  type DevicePackMetadata,
  deviceDefinitionSchema,
  devicePackMetadataSchema,
} from "./schema";

export type DevicePack = {
  metadata: DevicePackMetadata;
  devices: DeviceDefinition[];
};

export type DeviceRegistry = {
  list: () => DeviceDefinition[];
  get: (id: string) => DeviceDefinition | undefined;
  packs: () => DevicePackMetadata[];
};

export function parseDevicePack(input: {
  metadata: unknown;
  devices: unknown[];
}): DevicePack {
  return {
    metadata: devicePackMetadataSchema.parse(input.metadata),
    devices: input.devices.map((d) => deviceDefinitionSchema.parse(d)),
  };
}

// Later packs win on id collision so a custom pack can override a builtin.
export function createRegistry(packs: DevicePack[]): DeviceRegistry {
  const byId = new Map<string, DeviceDefinition>();
  for (const pack of packs) {
    for (const device of pack.devices) byId.set(device.id, device);
  }
  const all = [...byId.values()];
  return {
    list: () => all,
    get: (id) => byId.get(id),
    packs: () => packs.map((p) => p.metadata),
  };
}
