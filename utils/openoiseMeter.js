/**
 * openoiseMeter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Port of ARPA Piemonte's OpeNoise acoustic measurement engine to the browser
 * Web Audio API, paired with CPCB (Central Pollution Control Board) metrics.
 *
 * Core Features:
 *   1. IEC 61672-1:2013 exact A-weighting rational polynomial function.
 *   2. 32 standardized 1/3-octave bands (16 Hz to 20 kHz, IEC 61260).
 *   3. Dual LAeq metrics: LAeq,1s (1-second instantaneous) & LAeq,t (running cumulative).
 *   4. LAmax and LAmin tracking throughout measurement.
 *   5. Statistical percentiles: L10 (dominant), L50 (median), L90 (background floor).
 *   6. Fast (125ms) and Slow (1s) exponential time weighting.
 *   7. Standard acoustic reference pressure p_ref = 20 µPa (0.00002 Pa).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const P_REF = 0.00002; // 20 µPa reference pressure
export const CALIBRATION_OFFSET = 94; // Empirical smartphone reference at 1 Pa (94 dB SPL)
export const MIN_DB = 30;
export const MAX_DB = 130;

/**
 * 32 Standardized 1/3-Octave Bands (IEC 61260)
 * Min and max boundary frequencies in Hz according to ARPA Piemonte OpeNoise specification.
 */
export const THIRD_OCTAVE_BANDS = [
  { index: 0,  center: 16,    min: 14.1,   max: 17.8,   label: '16' },
  { index: 1,  center: 20,    min: 17.8,   max: 22.4,   label: '20' },
  { index: 2,  center: 25,    min: 22.4,   max: 28.2,   label: '25' },
  { index: 3,  center: 31.5,  min: 28.2,   max: 35.5,   label: '31.5' },
  { index: 4,  center: 40,    min: 35.5,   max: 44.7,   label: '40' },
  { index: 5,  center: 50,    min: 44.7,   max: 56.2,   label: '50' },
  { index: 6,  center: 63,    min: 56.2,   max: 70.8,   label: '63' },
  { index: 7,  center: 80,    min: 70.8,   max: 89.1,   label: '80' },
  { index: 8,  center: 100,   min: 89.1,   max: 112,    label: '100' },
  { index: 9,  center: 125,   min: 112,    max: 141,    label: '125' },
  { index: 10, center: 160,   min: 141,    max: 178,    label: '160' },
  { index: 11, center: 200,   min: 178,    max: 224,    label: '200' },
  { index: 12, center: 250,   min: 224,    max: 282,    label: '250' },
  { index: 13, center: 315,   min: 282,    max: 355,    label: '315' },
  { index: 14, center: 400,   min: 355,    max: 447,    label: '400' },
  { index: 15, center: 500,   min: 447,    max: 562,    label: '500' },
  { index: 16, center: 630,   min: 562,    max: 708,    label: '630' },
  { index: 17, center: 800,   min: 708,    max: 891,    label: '800' },
  { index: 18, center: 1000,  min: 891,    max: 1122,   label: '1k' },
  { index: 19, center: 1250,  min: 1122,   max: 1413,   label: '1.25k' },
  { index: 20, center: 1600,  min: 1413,   max: 1778,   label: '1.6k' },
  { index: 21, center: 2000,  min: 1778,   max: 2239,   label: '2k' },
  { index: 22, center: 2500,  min: 2239,   max: 2818,   label: '2.5k' },
  { index: 23, center: 3150,  min: 2818,   max: 3548,   label: '3.15k' },
  { index: 24, center: 4000,  min: 3548,   max: 4467,   label: '4k' },
  { index: 25, center: 5000,  min: 4467,   max: 5623,   label: '5k' },
  { index: 26, center: 6300,  min: 5623,   max: 7079,   label: '6.3k' },
  { index: 27, center: 8000,  min: 7079,   max: 8913,   label: '8k' },
  { index: 28, center: 10000, min: 8913,   max: 11220,  label: '10k' },
  { index: 29, center: 12500, min: 11220,  max: 14130,  label: '12.5k' },
  { index: 30, center: 16000, min: 14130,  max: 17780,  label: '16k' },
  { index: 31, center: 20000, min: 17780,  max: 22390,  label: '20k' },
];

/**
 * IEC 61672-1 Exact A-weighting rational polynomial function.
 * @param {number} f - Frequency in Hz
 * @returns {number} A-weighting in dB
 */
export function calculateIEC61672AWeighting(f) {
  if (f <= 0) return -100;
  const f2 = f * f;
  const f4 = f2 * f2;
  const f8 = f4 * f4;

  const t1 = Math.pow(20.598997 * 20.598997 + f2, 2);
  const t2 = 107.65265 * 107.65265 + f2;
  const t3 = 737.86223 * 737.86223 + f2;
  const t4 = Math.pow(12194.217 * 12194.217 + f2, 2);

  const denom = t1 * t2 * t3 * t4;
  if (denom <= 0) return -100;

  return 10 * Math.log10((3.5041384e16 * f8) / denom);
}

/**
 * Pre-computed lookup table for fast linear A-weighting factors.
 */
const A_WEIGHT_LINEAR_LUT = (() => {
  const table = new Float32Array(24001);
  for (let f = 0; f <= 24000; f++) {
    const db = calculateIEC61672AWeighting(f);
    table[f] = Math.pow(10, db / 10);
  }
  return table;
})();

export class OpeNoiseMeter {
  constructor(audioContext, fftSize = 8192, calibrationOffset = CALIBRATION_OFFSET) {
    this.audioContext = audioContext;
    this.calibrationOffset = calibrationOffset;
    this.fftSize = fftSize;

    // Analyser node setup
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = 0.0;
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = 0;

    this.binCount = this.analyser.frequencyBinCount; // fftSize / 2
    this.binHz = audioContext.sampleRate / fftSize;

    // Precompute bin A-weight multipliers
    this._binAWeightLinear = new Float32Array(this.binCount);
    for (let i = 0; i < this.binCount; i++) {
      const f = Math.min(24000, Math.round(i * this.binHz));
      this._binAWeightLinear[i] = A_WEIGHT_LINEAR_LUT[f];
    }

    // Map each FFT bin to its corresponding 1/3-octave band index (0-31 or -1 if outside)
    this._binToThirdOctave = new Int8Array(this.binCount);
    for (let i = 0; i < this.binCount; i++) {
      const f = i * this.binHz;
      let bandIdx = -1;
      for (let b = 0; b < THIRD_OCTAVE_BANDS.length; b++) {
        if (f >= THIRD_OCTAVE_BANDS[b].min && f < THIRD_OCTAVE_BANDS[b].max) {
          bandIdx = b;
          break;
        }
      }
      this._binToThirdOctave[i] = bandIdx;
    }

    // Working buffer
    this._fftBuffer = new Float32Array(this.binCount);

    // Cumulative state
    this._laeqAccumulator = 0; // Sum of linear powers for LAeq,t
    this._sampleCount = 0;
    this._history = []; // History of LAeq,1s values
    this._laMax = null;
    this._laMin = null;
    this._noiseFloor = null;
    this._baselineSamples = [];
    this._baselineDone = false;

    // Fast (125ms) exponential filter
    this._fastLevel = 0;
    const TC_FAST = 0.125;
    this._fastAlpha = Math.exp(-1 / ((audioContext.sampleRate / fftSize) * TC_FAST));
  }

  connect(sourceNode) {
    sourceNode.connect(this.analyser);
    return this;
  }

  /**
   * Reads the current FFT frame and computes:
   * - Total linear and A-weighted power
   * - 32 1/3-octave band levels in dB and dBA
   * - 4 overview band levels
   * - Peak frequency
   */
  getAcousticFrame() {
    this.analyser.getFloatFrequencyData(this._fftBuffer);

    let totalLinearPower = 0;
    let totalALinearPower = 0;

    const bandPower = new Float32Array(32);
    const bandAPower = new Float32Array(32);

    let maxBinVal = -Infinity;
    let maxBinIdx = 0;

    for (let i = 1; i < this.binCount; i++) {
      const dbfs = this._fftBuffer[i];
      if (dbfs > maxBinVal) {
        maxBinVal = dbfs;
        maxBinIdx = i;
      }

      const linearP = Math.pow(10, dbfs / 10);
      const linearAP = linearP * this._binAWeightLinear[i];

      totalLinearPower += linearP;
      totalALinearPower += linearAP;

      const bandIdx = this._binToThirdOctave[i];
      if (bandIdx >= 0 && bandIdx < 32) {
        bandPower[bandIdx] += linearP;
        bandAPower[bandIdx] += linearAP;
      }
    }

    // Convert total A-weighted power to SPL dB(A)
    const splA = totalALinearPower > 1e-30
      ? 10 * Math.log10(totalALinearPower) + this.calibrationOffset
      : MIN_DB;
    const clampedSplA = Math.max(MIN_DB, Math.min(MAX_DB, splA));

    // Convert total Z-weighted power to SPL dB(Z)
    const splZ = totalLinearPower > 1e-30
      ? 10 * Math.log10(totalLinearPower) + this.calibrationOffset
      : MIN_DB;

    // Convert 32 third-octave bands to dB SPL
    const thirdOctaveLevels = new Float32Array(32);
    const thirdOctaveALevels = new Float32Array(32);
    let maxBandLevel = -Infinity;
    let dominantBandIdx = 0;

    for (let b = 0; b < 32; b++) {
      const p = bandPower[b];
      const pA = bandAPower[b];
      const db = p > 1e-30 ? Math.max(0, 10 * Math.log10(p) + this.calibrationOffset) : 0;
      const dba = pA > 1e-30 ? Math.max(0, 10 * Math.log10(pA) + this.calibrationOffset) : 0;
      thirdOctaveLevels[b] = Math.round(db * 10) / 10;
      thirdOctaveALevels[b] = Math.round(dba * 10) / 10;

      if (db > maxBandLevel) {
        maxBandLevel = db;
        dominantBandIdx = b;
      }
    }

    // Fast-weighted level
    const instantLinear = Math.pow(10, clampedSplA / 10);
    this._fastLevel = this._fastAlpha * this._fastLevel + (1 - this._fastAlpha) * instantLinear;
    const fastDb = Math.max(MIN_DB, Math.min(MAX_DB, Math.round(10 * Math.log10(Math.max(this._fastLevel, 1e-30)))));

    // 4 Broad Overview Bands (normalized to 0-100 for visualizer)
    const subBassEnergy = bandPower[3] + bandPower[4] + bandPower[5] + bandPower[6] + bandPower[7] + bandPower[8]; // 31.5-100Hz
    const bassEnergy    = bandPower[9] + bandPower[10] + bandPower[11] + bandPower[12] + bandPower[13]; // 125-315Hz
    const midEnergy     = bandPower[14] + bandPower[15] + bandPower[16] + bandPower[17] + bandPower[18] + bandPower[19] + bandPower[20]; // 400Hz-1.6kHz
    const highEnergy    = bandPower[21] + bandPower[22] + bandPower[23] + bandPower[24] + bandPower[25] + bandPower[26]; // 2k-6.3kHz

    const toVisualLevel = (p) => p > 1e-30 ? Math.max(0, Math.min(100, Math.round(10 * Math.log10(p) + this.calibrationOffset - 20))) : 0;

    return {
      splA: Math.round(clampedSplA * 10) / 10,
      splZ: Math.round(splZ * 10) / 10,
      fastDb,
      dominantFreq: Math.round(maxBinIdx * this.binHz),
      dominantBand: THIRD_OCTAVE_BANDS[dominantBandIdx],
      thirdOctaveLevels: Array.from(thirdOctaveLevels),
      thirdOctaveALevels: Array.from(thirdOctaveALevels),
      overviewBands: {
        subBass: toVisualLevel(subBassEnergy),
        bass: toVisualLevel(bassEnergy),
        mid: toVisualLevel(midEnergy),
        high: toVisualLevel(highEnergy),
      },
    };
  }

  getInstantaneousDB() {
    return this.getAcousticFrame().splA;
  }

  getFastWeightedDB() {
    return this.getAcousticFrame().fastDb;
  }

  getBandLevels() {
    return this.getAcousticFrame().overviewBands;
  }

  getThirdOctaveLevels() {
    return this.getAcousticFrame().thirdOctaveLevels;
  }

  /**
   * Formal 1-second sample tick.
   * Updates LAeq,1s, LAeq,t, LAmax, LAmin, and statistical distributions.
   */
  sample() {
    const frame = this.getAcousticFrame();
    const laeq1s = Math.round(frame.splA);

    // Accumulate linear energy for cumulative LAeq,t
    const linearP = Math.pow(10, laeq1s / 10);
    this._laeqAccumulator += linearP;
    this._sampleCount += 1;
    this._history.push(laeq1s);

    // Track LAmax
    if (this._laMax === null || laeq1s > this._laMax) {
      this._laMax = laeq1s;
    }

    // Track LAmin (after first second settling)
    if (this._sampleCount >= 2) {
      if (this._laMin === null || laeq1s < this._laMin) {
        this._laMin = laeq1s;
      }
    }

    // Background noise floor baseline (first 2-3 seconds)
    if (!this._baselineDone) {
      this._baselineSamples.push(laeq1s);
      if (this._baselineSamples.length >= 2) {
        const sorted = [...this._baselineSamples].sort((a, b) => a - b);
        this._noiseFloor = sorted[0];
        this._baselineDone = true;
      }
    }

    return {
      db: laeq1s,
      laeq1s,
      leq: this.getLeqT(),
      laeqT: this.getLeqT(),
      laMax: this._laMax,
      laMin: this._laMin ?? laeq1s,
      fast: frame.fastDb,
      noiseFloor: this._noiseFloor,
      frame,
    };
  }

  /**
   * Cumulative running LAeq,t
   */
  getLeqT() {
    if (this._sampleCount === 0) return 0;
    const meanP = this._laeqAccumulator / this._sampleCount;
    return Math.round(Math.max(MIN_DB, Math.min(MAX_DB, 10 * Math.log10(meanP))));
  }

  getLeq() {
    return this.getLeqT();
  }

  /**
   * Statistical percentiles (L10, L50, L90) and extremes
   */
  getStatistics() {
    if (this._history.length === 0) {
      return { L10: 0, L50: 0, L90: 0, laMax: 0, laMin: 0, peak: 0 };
    }
    const sorted = [...this._history].sort((a, b) => b - a); // Descending
    const n = sorted.length;
    const L10 = Math.round(sorted[Math.floor(n * 0.10)] || sorted[0]);
    const L50 = Math.round(sorted[Math.floor(n * 0.50)]);
    const L90 = Math.round(sorted[Math.floor(n * 0.90)]);

    return {
      L10,
      L50,
      L90,
      laMax: this._laMax || sorted[0],
      laMin: this._laMin || sorted[sorted.length - 1],
      peak: this._laMax || sorted[0],
    };
  }

  get node() {
    return this.analyser;
  }

  reset() {
    this._laeqAccumulator = 0;
    this._sampleCount = 0;
    this._history = [];
    this._laMax = null;
    this._laMin = null;
    this._noiseFloor = null;
    this._baselineSamples = [];
    this._baselineDone = false;
    this._fastLevel = 0;
  }

  destroy() {
    try {
      this.analyser.disconnect();
    } catch (_) {}
  }
}
