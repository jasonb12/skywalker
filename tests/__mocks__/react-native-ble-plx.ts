// Mock for react-native-ble-plx (Flow-based package, can't be parsed by Vitest)

export class BleManager {
  state() {
    return Promise.resolve('PoweredOn');
  }
  startDeviceScan() {}
  stopDeviceScan() {}
  destroy() {}
}

export const State = {
  Unknown: 'Unknown',
  Resetting: 'Resetting',
  Unsupported: 'Unsupported',
  Unauthorized: 'Unauthorized',
  PoweredOff: 'PoweredOff',
  PoweredOn: 'PoweredOn',
};
