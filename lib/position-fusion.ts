/**
 * Position Fusion Engine
 *
 * Combines GPS, BLE trilateration, and dead-reckoning into a single
 * fused position estimate using a weighted Kalman-inspired approach.
 *
 * Priority:
 * 1. BLE trilateration (best indoors, 2-5m accuracy)
 * 2. GPS (best outdoors, 5-15m accuracy)
 * 3. Dead reckoning (fallback when both are unavailable)
 *
 * The fused position uses confidence-weighted averaging where the
 * source with lower accuracy radius gets more weight.
 */

import type { UserPosition, DetectedBeacon } from './types';
import { trilateratePosition } from './trilateration';

interface FusionConfig {
  /** Maximum GPS accuracy to consider reliable (meters) */
  maxGpsAccuracy: number;
  /** Maximum BLE accuracy to consider reliable (meters) */
  maxBleAccuracy: number;
  /** Weight multiplier for BLE when indoors (0-1, higher = trust BLE more) */
  bleIndoorWeight: number;
  /** Weight multiplier for GPS when outdoors (0-1, higher = trust GPS more) */
  gpsOutdoorWeight: number;
  /** Dead reckoning decay factor (position gets less reliable over time) */
  deadReckoningDecay: number;
  /** Maximum time (ms) before dead reckoning position is considered stale */
  maxDeadReckoningAge: number;
}

const DEFAULT_CONFIG: FusionConfig = {
  maxGpsAccuracy: 30,
  maxBleAccuracy: 20,
  bleIndoorWeight: 0.7,
  gpsOutdoorWeight: 0.6,
  deadReckoningDecay: 0.95,
  maxDeadReckoningAge: 30000, // 30 seconds
};

interface PositionSource {
  position: UserPosition;
  timestamp: number;
  confidence: number; // 0-1, higher is better
}

export class PositionFusionEngine {
  private config: FusionConfig;
  private lastGps: PositionSource | null = null;
  private lastBle: PositionSource | null = null;
  private lastDeadReckoning: PositionSource | null = null;
  private lastFused: UserPosition | null = null;
  private lastFusedTimestamp: number = 0;

  constructor(config?: Partial<FusionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update with a new GPS position.
   */
  updateGps(position: UserPosition): void {
    const confidence = this.gpsConfidence(position.accuracy);
    this.lastGps = {
      position,
      timestamp: Date.now(),
      confidence,
    };
  }

  /**
   * Update with new BLE beacon detections.
   * Performs trilateration and stores the result.
   */
  updateBle(detectedBeacons: DetectedBeacon[]): void {
    const blePosition = trilateratePosition(detectedBeacons);
    if (!blePosition) return;

    const confidence = this.bleConfidence(blePosition.accuracy, detectedBeacons.length);

    this.lastBle = {
      position: {
        latitude: blePosition.latitude,
        longitude: blePosition.longitude,
        accuracy: blePosition.accuracy,
        heading: null,
        source: 'ble',
        bleBeaconsInRange: detectedBeacons.length,
      },
      timestamp: Date.now(),
      confidence,
    };
  }

  /**
   * Update with a dead-reckoning position estimate.
   */
  updateDeadReckoning(position: UserPosition): void {
    this.lastDeadReckoning = {
      position,
      timestamp: Date.now(),
      confidence: 0.3, // low base confidence
    };
  }

  /**
   * Get the best fused position estimate.
   *
   * Combines available sources using confidence-weighted averaging.
   * Returns the most reliable position available.
   */
  getFusedPosition(): UserPosition | null {
    const now = Date.now();
    const sources: PositionSource[] = [];

    // Check GPS freshness (valid for 10 seconds)
    if (this.lastGps && now - this.lastGps.timestamp < 10000) {
      sources.push(this.lastGps);
    }

    // Check BLE freshness (valid for 5 seconds)
    if (this.lastBle && now - this.lastBle.timestamp < 5000) {
      sources.push(this.lastBle);
    }

    // Check dead reckoning freshness
    if (
      this.lastDeadReckoning &&
      now - this.lastDeadReckoning.timestamp < this.config.maxDeadReckoningAge
    ) {
      // Decay confidence over time
      const age = now - this.lastDeadReckoning.timestamp;
      const decayFactor = Math.pow(
        this.config.deadReckoningDecay,
        age / 1000
      );
      this.lastDeadReckoning.confidence = 0.3 * decayFactor;
      sources.push(this.lastDeadReckoning);
    }

    if (sources.length === 0) {
      return this.lastFused; // return last known position
    }

    if (sources.length === 1) {
      this.lastFused = sources[0].position;
      this.lastFusedTimestamp = now;
      return this.lastFused;
    }

    // Weighted fusion of multiple sources
    let totalWeight = 0;
    let latSum = 0;
    let lngSum = 0;
    let bestHeading: number | null = null;
    let bestSource: UserPosition['source'] = 'fused';
    let bestConfidence = 0;
    let totalBleBeacons = 0;

    for (const src of sources) {
      const weight = src.confidence;
      latSum += src.position.latitude * weight;
      lngSum += src.position.longitude * weight;
      totalWeight += weight;

      // Use heading from the most confident source
      if (src.confidence > bestConfidence) {
        bestConfidence = src.confidence;
        bestHeading = src.position.heading;
      }

      if (src.position.bleBeaconsInRange) {
        totalBleBeacons = Math.max(totalBleBeacons, src.position.bleBeaconsInRange);
      }
    }

    // Determine dominant source for labeling
    const hasBle = sources.some((s) => s.position.source === 'ble');
    const hasGps = sources.some((s) => s.position.source === 'gps');
    if (hasBle && hasGps) {
      bestSource = 'fused';
    } else if (hasBle) {
      bestSource = 'ble';
    } else if (hasGps) {
      bestSource = 'gps';
    } else {
      bestSource = 'dead-reckoning';
    }

    // Calculate fused accuracy (weighted harmonic mean)
    const accuracyWeights = sources.map((s) => s.confidence / s.position.accuracy);
    const fusedAccuracy = totalWeight / accuracyWeights.reduce((a, b) => a + b, 0);

    this.lastFused = {
      latitude: latSum / totalWeight,
      longitude: lngSum / totalWeight,
      accuracy: Math.max(fusedAccuracy, 1),
      heading: bestHeading,
      source: bestSource,
      bleBeaconsInRange: totalBleBeacons || undefined,
    };
    this.lastFusedTimestamp = now;

    return this.lastFused;
  }

  /**
   * Get the current positioning source status.
   */
  getStatus(): {
    gpsAvailable: boolean;
    bleAvailable: boolean;
    deadReckoningActive: boolean;
    bleBeaconCount: number;
    fusedSource: string;
  } {
    const now = Date.now();
    return {
      gpsAvailable: !!this.lastGps && now - this.lastGps.timestamp < 10000,
      bleAvailable: !!this.lastBle && now - this.lastBle.timestamp < 5000,
      deadReckoningActive:
        !!this.lastDeadReckoning &&
        now - this.lastDeadReckoning.timestamp < this.config.maxDeadReckoningAge,
      bleBeaconCount: this.lastBle?.position.bleBeaconsInRange ?? 0,
      fusedSource: this.lastFused?.source ?? 'none',
    };
  }

  /**
   * Reset all position sources.
   */
  reset(): void {
    this.lastGps = null;
    this.lastBle = null;
    this.lastDeadReckoning = null;
    this.lastFused = null;
    this.lastFusedTimestamp = 0;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private gpsConfidence(accuracy: number): number {
    if (accuracy <= 5) return 0.9;
    if (accuracy <= 10) return 0.7;
    if (accuracy <= 20) return 0.4;
    if (accuracy <= this.config.maxGpsAccuracy) return 0.2;
    return 0.1;
  }

  private bleConfidence(accuracy: number, beaconCount: number): number {
    // More beacons = higher confidence
    let base = 0.3;
    if (beaconCount >= 4) base = 0.9;
    else if (beaconCount >= 3) base = 0.8;
    else if (beaconCount >= 2) base = 0.6;

    // Penalize high accuracy radius
    if (accuracy > 10) base *= 0.7;
    if (accuracy > 20) base *= 0.5;

    return Math.min(base, 1);
  }
}
