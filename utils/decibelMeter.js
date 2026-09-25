/**
 * decibelMeter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Professional-grade A-weighted dB(A) acoustic measurement engine powered by
 * ARPA Piemonte OpeNoise DSP, IEC 61672-1 rational polynomial A-weighting, and
 * standardized 32 1/3-octave spectral analysis.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  OpeNoiseMeter,
  P_REF,
  CALIBRATION_OFFSET,
  MIN_DB,
  MAX_DB,
  THIRD_OCTAVE_BANDS,
  calculateIEC61672AWeighting,
} from './openoiseMeter';

export {
  OpeNoiseMeter,
  P_REF,
  CALIBRATION_OFFSET,
  MIN_DB,
  MAX_DB,
  THIRD_OCTAVE_BANDS,
  calculateIEC61672AWeighting,
};

/**
 * Detects approximate device type from User-Agent to adjust calibration offset.
 * Phone mics vary by 6-8 dB across device classes.
 *
 * Returns a calibration offset suggestion (add to CALIBRATION_OFFSET).
 * @returns {number} Offset adjustment in dB
 */
export function getDeviceCalibrationAdjustment() {
  if (typeof navigator === 'undefined') return 0;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad')) return +3;  // iPhones tend to have more sensitive mics
  if (ua.includes('samsung') && ua.includes('sm-s')) return +2; // Samsung S-series (flagship)
  if (ua.includes('samsung') && ua.includes('sm-a')) return 0;  // Samsung A-series (mid-range)
  if (ua.includes('pixel')) return +1;                           // Google Pixel
  return 0;                                                       // Default: mid-range Android
}

/**
 * Combined calibration offset for the current device.
 */
export function getCalibrationOffset() {
  return CALIBRATION_OFFSET + getDeviceCalibrationAdjustment();
}

/**
 * DecibelMeter class: Backward-compatible wrapper over OpeNoiseMeter.
 */
export class DecibelMeter extends OpeNoiseMeter {
  constructor(audioContext, fftSize = 8192, calibrationOffset = getCalibrationOffset()) {
    super(audioContext, fftSize, calibrationOffset);
  }
}
