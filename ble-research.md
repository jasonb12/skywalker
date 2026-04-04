# BLE Fingerprinting Indoor Positioning - Research Notes

## Core Concept: RSSI Fingerprinting
Two phases:
1. **Offline/Training Phase**: Walk around collecting BLE scans at known GPS positions. Store as fingerprints: {position -> {deviceId: avgRSSI, ...}}
2. **Online/Positioning Phase**: Take a live BLE scan, compare against stored fingerprints, find the best match to estimate position.

## Best Algorithm: Weighted K-Nearest Neighbors (WKNN)
- Compare live scan's RSSI vector against all stored fingerprints
- Use Euclidean distance in RSSI space to find K closest matches
- Weight closer matches more heavily (1/distance or 1/distance^2)
- Average the weighted GPS positions = estimated location
- K=3-5 works well in practice
- Achieves ~1-3m accuracy with sufficient fingerprints

## Key Implementation Details
- **Signal Distance**: Euclidean distance between RSSI vectors. For devices not seen in one scan but present in another, use a floor value (e.g., -100 dBm)
- **RSSI Smoothing**: Average multiple RSSI readings per device (RSSI is noisy). Use running average or Kalman filter.
- **Fingerprint Density**: More reference points = better accuracy. ~2-3m spacing is ideal.
- **Crowdsourced Collection**: Collect fingerprints as user walks with GPS. When GPS is good (outdoors/near windows), save fingerprints automatically.
- **Device Diversity**: Different phones report different RSSI for same signal. Normalize by using relative differences between devices rather than absolute values.

## Our Approach for Skywalker
1. **Continuous BLE scanning** - scan all devices, not just beacons
2. **Auto-collect fingerprints** when GPS confidence is high (near building entrances, windows)
3. **Store fingerprints in AsyncStorage** with GPS position + timestamp
4. **WKNN matching** when GPS is poor (indoor) - compare live scan against stored fingerprints
5. **Grow the database** over time as user walks more routes
6. **Show BLE details panel** with all discovered devices, RSSI, and estimated position

## Signal Processing
- Kalman filter for RSSI smoothing (reduces noise by ~40%)
- Exponential moving average as simpler alternative: rssi_smooth = alpha * rssi_new + (1-alpha) * rssi_old, alpha=0.3
- Discard readings older than 10 seconds
- Minimum 3 common devices between live scan and fingerprint for valid match
