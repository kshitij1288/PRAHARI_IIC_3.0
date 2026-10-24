/**
 * PRAHARI - Wayanad Landslide Preparedness & Local Slope-Monitoring System
 * Live Telemetry Client (integrated with https://api.prahari.space) & Simulator Sandbox
 *
 * Heritage: <HYPNEXIS> & prahari.space
 */

// --- Global App State ---
const state = {
  mode: 'live', // 'live' | 'sim'
  apiBase: 'https://api.prahari.space',
  isPollingActive: true,
  isLiveConnected: false,
  pollIntervalMs: 3000,
  historyLimit: 40,
  pollTimerId: null,

  // Selected chart metric
  chartMetric: 'risk', // 'risk' | 'moisture' | 'vibration' | 'pressure'

  // Rolling telemetry buffer (last 40 readings)
  readings: [],

  // Latest reading reference
  latest: null,

  // Simulation State (for Sim mode)
  sim: {
    isRunning: true,
    scenario: 'baseline',
    rainfallRate: 1.5,
    rainfall24h: 3.2,
    soilMoisture: 32.4,
    soilMoisture2: 29.8,
    tiltAngle: 0.08,
    accelX: 0.02,
    accelY: -0.04,
    accelZ: 9.81,
    accelMag: 9.82,
    vibration: 14,
    temperature: 21.8,
    humidity: 58,
    baroPressure: 1013.2,
    riskScore: 22,
    confidence: 88,
    rainState: 0,
    targetRainfall: 1.5,
    targetMoisture: 32.4,
    targetTilt: 0.08,
    targetVibration: 14,
    simTime: new Date(2026, 9, 24, 16, 21, 52)
  }
};

// --- prahari.space Data Normalizer (exact logic from gA(e)) ---
function parsePrahariPacket(e) {
  if (!e || typeof e !== 'object') return null;
  const first = (...values) => {
    for (const value of values) if (value !== undefined && value !== null && value !== '') return value;
    return null;
  };
  const numberOrNull = (...values) => {
    const value = first(...values);
    if (value === null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const rawRisk = numberOrNull(e.landslide_probability_pct, e.prediction_pct, e.risk_score);
  const riskLabel = String(first(e.risk, e.risk_label, e.risk_level, '')).toUpperCase();
  const risk = rawRisk !== null ? Math.max(0, Math.min(100, Math.round(rawRisk))) :
    riskLabel === 'HIGH' ? 100 : riskLabel === 'MEDIUM' ? 50 : riskLabel === 'LOW' ? 0 : null;
  const ax = numberOrNull(e.ax, e.accel_x, e.accelX);
  const ay = numberOrNull(e.ay, e.accel_y, e.accelY);
  const az = numberOrNull(e.az, e.accel_z, e.accelZ);
  const magnitude = numberOrNull(e.accel_magnitude, e.magnitude, e.accelMag);
  const dynamicAccel = numberOrNull(e.dynamic_accel, e.dynamicAccel);
  const vibration = numberOrNull(e.vibration_score_10, e.vibration_score, e.vibration);
  const s1Raw = numberOrNull(e.s1_adc);
  const s2Raw = numberOrNull(e.s2_adc);
  const s1 = numberOrNull(e.s1_pct, e.moisture);
  const s2 = numberOrNull(e.s2_pct, e.moisture2);
  const gpsValid = Boolean(e.gps_valid ?? (e.latitude != null && e.longitude != null));
  const timestamp = first(e.timestamp, e.created_at, e.time);
  const sampleId = first(e.sample_id, e.sampleId, e.id);
  const rssi = numberOrNull(e.wifi_rssi_dbm, e.wifi_rssi);
  const wifiPct = numberOrNull(e.wifi_strength_percent_estimate, e.wifi_percent);
  const simPct = numberOrNull(e.sim_signal_percent_estimate, e.sim_signal_percent);
  return {
    ts: timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
    rawTs: timestamp || Date.now(),
    deviceId: first(e.device_id, e.node_id, 'PRAHARI node'),
    sampleId: sampleId ?? (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    moisture: s1, moisture2: s2, s1Raw, s2Raw,
    accelX: ax, accelY: ay, accelZ: az, accelMag: magnitude,
    dynamicAccel, vibration,
    pitch: numberOrNull(e.pitch_deg, e.pitch), roll: numberOrNull(e.roll_deg, e.roll),
    micP2P: numberOrNull(e.mic_peak_to_peak_adc, e.mic_peak_to_peak),
    micDbfs: numberOrNull(e.mic_dbfs_estimate, e.mic_dbfs),
    micFrequency: numberOrNull(e.mic_dominant_frequency_hz_estimate, e.mic_dominant_hz),
    rain: Number(first(e.rain_detected, e.rain, 0)) ? 1 : 0,
    rainRaw: numberOrNull(e.rain_raw),
    gpsValid, latitude: numberOrNull(e.latitude), longitude: numberOrNull(e.longitude),
    gpsSatellites: numberOrNull(e.gps_satellites), gpsHdop: numberOrNull(e.gps_hdop),
    wifiRssi: rssi, wifiPercent: wifiPct, simPercent: simPct,
    simReady: Boolean(e.sim_ready),
    risk, riskLabel, confidence: numberOrNull(e.confidence),
    backendStatus: first(e.backend_status, e.status, null),
    humidity: null, pressure: null, temp: null
  };
}

// --- prahari.space Risk Classification (bA(e)) ---
function classifyRisk(score) {
  if (score < 34) {
    return {
      label: "LOW",
      color: "#10B981",
      condition: "Stable Slope Conditions",
      bg: "rgba(16, 185, 129, 0.12)",
      border: "rgba(16, 185, 129, 0.3)",
      badgeClass: "level-normal",
      chipClass: "chip-low"
    };
  } else if (score < 67) {
    return {
      label: "MEDIUM",
      color: "#F59E0B",
      condition: "Elevated Monitoring Conditions",
      bg: "rgba(245, 158, 11, 0.14)",
      border: "rgba(245, 158, 11, 0.35)",
      badgeClass: "level-advisory",
      chipClass: "chip-med"
    };
  } else {
    return {
      label: "HIGH",
      color: "#E34234",
      condition: "Critical — Review Alert Active",
      bg: "rgba(227, 66, 52, 0.16)",
      border: "rgba(227, 66, 52, 0.45)",
      badgeClass: "level-critical",
      chipClass: "chip-high"
    };
  }
}

// --- Simulation Presets ---
const SCENARIOS = {
  baseline: {
    name: 'Dry Baseline',
    rain: 0,
    moisture: 28.5,
    moisture2: 24.2,
    tilt: 0.05,
    accelX: 0.01,
    accelY: -0.02,
    accelZ: 9.81,
    vibration: 12,
    temp: 23.4,
    humidity: 52,
    pressure: 1014.2,
    risk: 18,
    confidence: 94
  },
  moderate: {
    name: 'Moderate Rain',
    rain: 1,
    moisture: 56.4,
    moisture2: 48.0,
    tilt: 0.25,
    accelX: 0.12,
    accelY: -0.15,
    accelZ: 9.79,
    vibration: 32,
    temp: 18.6,
    humidity: 84,
    pressure: 1008.5,
    risk: 49,
    confidence: 89
  },
  threshold60: {
    name: '60% Advisory Threshold Breach',
    rain: 1,
    moisture: 78.4,
    moisture2: 72.5,
    tilt: 0.78,
    accelX: 0.45,
    accelY: -0.62,
    accelZ: 9.72,
    vibration: 72,
    temp: 16.5,
    humidity: 95,
    pressure: 998.2,
    risk: 68,
    confidence: 91
  },
  threshold85: {
    name: '85% Critical Review Threshold Breach',
    rain: 1,
    moisture: 94.2,
    moisture2: 89.6,
    tilt: 2.15,
    accelX: 1.45,
    accelY: -1.82,
    accelZ: 9.54,
    vibration: 154,
    temp: 15.2,
    humidity: 98,
    pressure: 989.4,
    risk: 91,
    confidence: 95
  }
};

// --- DOM References ---
let dom = {};

function initDom() {
  dom = {
    // Mode switcher
    btnModeLive: document.getElementById('btnModeLive'),
    btnModeSim: document.getElementById('btnModeSim'),
    activeModeLabel: document.getElementById('activeModeLabel'),
    liveConnectionBanner: document.getElementById('liveConnectionBanner'),
    simModeWarning: document.getElementById('simModeWarning'),
    simControlsCard: document.getElementById('simControlsCard'),
    manualTuningPanel: document.getElementById('manualTuningPanel'),

    // Live Connection Controls
    liveConnStatusText: document.getElementById('liveConnStatusText'),
    liveConnBadge: document.getElementById('liveConnBadge'),
    livePulseRing: document.getElementById('livePulseRing'),
    livePulseCore: document.getElementById('livePulseCore'),
    displayApiEndpoint: document.getElementById('displayApiEndpoint'),
    emptyTableEndpoint: document.getElementById('emptyTableEndpoint'),
    togglePollingBtn: document.getElementById('togglePollingBtn'),
    togglePollingIcon: document.getElementById('togglePollingIcon'),
    togglePollingText: document.getElementById('togglePollingText'),
    injectSampleBtn: document.getElementById('injectSampleBtn'),
    openApiSettingsBtn: document.getElementById('openApiSettingsBtn'),

    // Header Live Status
    headerLiveDot: document.getElementById('headerLiveDot'),
    headerLiveText: document.getElementById('headerLiveText'),
    headerLiveStatus: document.getElementById('headerLiveStatus'),

    // Hero Preview Elements
    heroRiskVal: document.getElementById('heroRiskVal'),
    heroRiskStatus: document.getElementById('heroRiskStatus'),
    heroMoistVal: document.getElementById('heroMoistVal'),
    heroBackendBadge: document.getElementById('heroBackendBadge'),

    // Main Risk Banner
    bannerCard: document.getElementById('bannerCard'),
    bannerRiskScore: document.getElementById('bannerRiskScore'),
    bannerRiskLabel: document.getElementById('bannerRiskLabel'),
    bannerTierChip: document.getElementById('bannerTierChip'),
    bannerConditionTitle: document.getElementById('bannerConditionTitle'),
    bannerConditionDesc: document.getElementById('bannerConditionDesc'),
    bannerLastTime: document.getElementById('bannerLastTime'),
    bannerTotalCount: document.getElementById('bannerTotalCount'),
    bannerConfidenceText: document.getElementById('bannerConfidenceText'),
    sirenIndicator: document.getElementById('sirenIndicator'),
    riskAlarmBanner: document.getElementById('riskAlarmBanner'),
    alarmSubtext: document.getElementById('alarmSubtext'),

    // 8 Telemetry Cards
    cardMoisture1: document.getElementById('cardMoisture1'),
    cardMoisture2: document.getElementById('cardMoisture2'),
    cardVibration: document.getElementById('cardVibration'),
    cardTilt: document.getElementById('cardTilt'),
    cardRain: document.getElementById('cardRain'),
    cardHumidity: document.getElementById('cardHumidity'),
    cardTemp: document.getElementById('cardTemp'),
    cardPressure: document.getElementById('cardPressure'),

    metricMoisture1: document.getElementById('metricMoisture1'),
    metricMoisture2: document.getElementById('metricMoisture2'),
    metricVibration: document.getElementById('metricVibration'),
    valAccelX: document.getElementById('valAccelX'),
    valAccelY: document.getElementById('valAccelY'),
    valAccelZ: document.getElementById('valAccelZ'),
    metricRainState: document.getElementById('metricRainState'),
    metricRainSub: document.getElementById('metricRainSub'),
    metricHumidity: document.getElementById('metricHumidity'),
    metricTemp: document.getElementById('metricTemp'),
    metricPressure: document.getElementById('metricPressure'),
    metricMic: document.getElementById('metricMic'),
    metricGps: document.getElementById('metricGps'),
    metricConnectivity: document.getElementById('metricConnectivity'),
    metricMicSub: document.getElementById('metricMicSub'),
    metricGpsSub: document.getElementById('metricGpsSub'),
    metricConnectivitySub: document.getElementById('metricConnectivitySub'),


    // Chart
    activeChartTitle: document.getElementById('activeChartTitle'),
    slopeTrendCanvas: document.getElementById('slopeTrendCanvas'),
    chartThresholdLegend: document.getElementById('chartThresholdLegend'),
    chartFooterText: document.getElementById('chartFooterText'),
    chartTabs: document.querySelectorAll('.btn-chart-tab'),

    // Log Table
    logCountPill: document.getElementById('logCountPill'),
    sensorLogTbody: document.getElementById('sensorLogTbody'),
    clearLogBtn: document.getElementById('clearLogBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn'),

    // Modal
    apiConfigModal: document.getElementById('apiConfigModal'),
    inputApiEndpoint: document.getElementById('inputApiEndpoint'),
    saveApiEndpointBtn: document.getElementById('saveApiEndpointBtn'),
    resetApiEndpointBtn: document.getElementById('resetApiEndpointBtn'),
    closeApiModalBtn: document.getElementById('closeApiModalBtn'),

    // Simulator Sliders & Controls
    sliderRainfall: document.getElementById('sliderRainfall'),
    sliderMoisture: document.getElementById('sliderMoisture'),
    sliderTilt: document.getElementById('sliderTilt'),
    sliderVibration: document.getElementById('sliderVibration'),
    valRainfall: document.getElementById('valRainfall'),
    valMoisture: document.getElementById('valMoisture'),
    valTilt: document.getElementById('valTilt'),
    valVibration: document.getElementById('valVibration'),
    simTimeDisplay: document.getElementById('simTimeDisplay'),
    resetSimBtn: document.getElementById('resetSimBtn'),
    scenarioBtns: document.querySelectorAll('.btn-scenario')
  };
}

// --- Live Backend Network Operations ---

// 1. Fetch History on mount
async function fetchHistory() {
  if (state.mode !== 'live') return;
  try {
    const url = `${state.apiBase}/api/history?limit=${state.historyLimit}`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    
    const items = (json.data || []).map(parsePrahariPacket).filter(Boolean);
    if (items.length > 0) {
      state.readings = items.slice(-state.historyLimit);
      state.latest = state.readings[state.readings.length - 1];
      setLiveConnectionStatus(true, `Connected · ${items.length} historical readings loaded`);
    } else {
      setLiveConnectionStatus(true, `Connected to ${state.apiBase} (Waiting for ESP32 packet)`);
    }
    renderDashboard();
  } catch (err) {
    console.warn('History fetch error:', err.message);
    setLiveConnectionStatus(false, 'Waiting for PRAHARI backend');
  }
}

// 2. Poll Latest reading periodically (every 3000ms)
async function fetchLatest() {
  if (state.mode !== 'live' || !state.isPollingActive) return;
  try {
    const url = `${state.apiBase}/api/latest`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    
    setLiveConnectionStatus(true, `LIVE — ESP32 Feed`);

    if (json.latest) {
      const parsed = parsePrahariPacket(json.latest);
      if (parsed) {
        // Only append if it's a new sampleId or time has changed
        const last = state.readings[state.readings.length - 1];
        if (!last || last.sampleId !== parsed.sampleId) {
          state.readings = [...state.readings.slice(-(state.historyLimit - 1)), parsed];
          state.latest = parsed;
          renderDashboard(true);
        }
      }
    } else if (state.readings.length === 0) {
      // Backend returned {"ok": true, "latest": null}
      setLiveConnectionStatus(true, `Backend Online · Waiting for ESP32 /data`);
    }
  } catch (err) {
    console.warn('Latest fetch error:', err.message);
    setLiveConnectionStatus(false, 'Backend unavailable');
  }
}

// --- Live Connection Status UI Handler ---
function setLiveConnectionStatus(isConnected, message) {
  state.isLiveConnected = isConnected;

  if (dom.liveConnStatusText) dom.liveConnStatusText.textContent = message.toUpperCase();
  if (dom.headerLiveText) dom.headerLiveText.textContent = isConnected ? 'LIVE FEED' : 'OFFLINE';

  if (isConnected) {
    if (dom.livePulseCore) dom.livePulseCore.style.background = '#27ae60';
    if (dom.livePulseRing) dom.livePulseRing.style.background = '#27ae60';
    if (dom.headerLiveStatus) dom.headerLiveStatus.className = 'live-status-pill';
    if (dom.headerLiveDot) dom.headerLiveDot.style.background = '#27ae60';
  } else {
    if (dom.livePulseCore) dom.livePulseCore.style.background = '#e67e22';
    if (dom.livePulseRing) dom.livePulseRing.style.background = '#e67e22';
    if (dom.headerLiveStatus) dom.headerLiveStatus.className = 'live-status-pill offline';
    if (dom.headerLiveDot) dom.headerLiveDot.style.background = '#555';
  }
}

// --- Inject Test ESP32 Reading (Demonstration Support) ---
let injectCycle = 0;
function injectTestPacket() {
  const scenarios = [SCENARIOS.baseline, SCENARIOS.moderate, SCENARIOS.threshold60, SCENARIOS.threshold85];
  const chosen = scenarios[injectCycle % scenarios.length];
  injectCycle++;

  const syntheticSample = {
    timestamp: new Date().toISOString(),
    s1_pct: chosen.moisture + (Math.random() - 0.5) * 2,
    s2_pct: chosen.moisture2 + (Math.random() - 0.5) * 2,
    ax: chosen.accelX + (Math.random() - 0.5) * 0.05,
    ay: chosen.accelY + (Math.random() - 0.5) * 0.05,
    az: chosen.accelZ,
    magnitude: 9.81 + (chosen.vibration / 1000),
    rain_detected: chosen.rain,
    dht_humidity: chosen.humidity,
    dht_temp: chosen.temp,
    bmp_pressure: chosen.pressure,
    risk_score: chosen.risk,
    confidence: chosen.confidence,
    sample_id: 'SIM-' + Date.now().toString(36)
  };

  const parsed = parsePrahariPacket(syntheticSample);
  state.readings = [...state.readings.slice(-(state.historyLimit - 1)), parsed];
  state.latest = parsed;

  setLiveConnectionStatus(true, `Test Reading Injected (${chosen.name})`);
  renderDashboard(true);
}

// --- Render Unified Dashboard (Cards, Banner, Gauge, Log, Chart) ---
function fmt(value, digits = 1, suffix = '') {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? 'N/A' : `${Number(value).toFixed(digits)}${suffix}`;
}

// --- Render Unified Dashboard using fields actually sent by the ESP32 ---
function renderDashboard(isNewData = false) {
  let d = state.latest;
  if (!d && state.mode === 'sim') {
    const s = state.sim;
    d = {
      ts: s.simTime.toLocaleTimeString(), moisture: s.soilMoisture, moisture2: s.soilMoisture2,
      s1Raw: null, s2Raw: null, accelX: s.accelX, accelY: s.accelY, accelZ: s.accelZ,
      accelMag: s.accelMag, dynamicAccel: s.vibration / 1000, vibration: Math.min(10, s.vibration / 20),
      pitch: s.tiltAngle, roll: null, micP2P: null, micDbfs: null, micFrequency: null,
      rain: s.rainState, gpsValid: false, latitude: null, longitude: null, gpsSatellites: 0,
      gpsHdop: null, wifiRssi: null, wifiPercent: null, simPercent: null, simReady: false,
      risk: s.riskScore, confidence: s.confidence, sampleId: `SIM-${Date.now()}`
    };
  }
  if (!d) d = {
    ts: '--', moisture: null, moisture2: null, s1Raw: null, s2Raw: null,
    accelX: null, accelY: null, accelZ: null, accelMag: null, dynamicAccel: null,
    vibration: null, pitch: null, roll: null, micP2P: null, micDbfs: null, micFrequency: null,
    rain: null, gpsValid: false, latitude: null, longitude: null, gpsSatellites: null,
    gpsHdop: null, wifiRssi: null, wifiPercent: null, simPercent: null, simReady: false,
    risk: null, confidence: null, sampleId: '--'
  };

  const riskKnown = d.risk !== null && d.risk !== undefined && Number.isFinite(Number(d.risk));
  const riskClass = riskKnown ? classifyRisk(Number(d.risk)) : {
    label: 'UNAVAILABLE', color: '#8ba8ad', condition: 'Awaiting backend prediction',
    chipClass: 'chip-med'
  };
  const riskText = riskKnown ? String(Math.round(Number(d.risk))) : 'N/A';

  if (dom.heroRiskVal) dom.heroRiskVal.innerHTML = `${riskText}<span class="unit">${riskKnown ? '/100' : ''}</span>`;
  if (dom.heroRiskStatus) dom.heroRiskStatus.textContent = riskClass.condition;
  if (dom.heroMoistVal) dom.heroMoistVal.innerHTML = `${fmt(d.moisture)}<span class="unit">${d.moisture == null ? '' : '%'}</span>`;
  if (dom.bannerRiskScore) {
    dom.bannerRiskScore.innerHTML = `${riskText}<span class="banner-score-pct">${riskKnown ? '%' : ''}</span>`;
    dom.bannerRiskScore.style.color = riskClass.color;
  }
  if (dom.bannerTierChip) {
    dom.bannerTierChip.textContent = `RISK LEVEL: ${riskClass.label}`;
    dom.bannerTierChip.style.color = riskClass.color;
  }
  if (dom.bannerConditionTitle) dom.bannerConditionTitle.textContent = riskClass.condition;
  if (dom.bannerLastTime) dom.bannerLastTime.textContent = d.ts;
  if (dom.bannerTotalCount) dom.bannerTotalCount.textContent = state.readings.length;
  if (dom.bannerConfidenceText) dom.bannerConfidenceText.textContent =
    d.confidence !== null && d.confidence !== undefined ? `Model confidence: ${fmt(d.confidence, 1, '%')}` : 'No model confidence returned';

  if (dom.bannerCard) {
    dom.bannerCard.className = 'prahari-banner-card';
    if (riskKnown && Number(d.risk) >= 67) dom.bannerCard.classList.add('banner-high');
    else if (riskKnown && Number(d.risk) >= 34) dom.bannerCard.classList.add('banner-medium');
  }
  if (dom.sirenIndicator) dom.sirenIndicator.style.display = riskKnown && Number(d.risk) >= 67 ? 'inline-block' : 'none';
  if (dom.riskAlarmBanner) {
    dom.riskAlarmBanner.style.display = riskKnown && Number(d.risk) >= 67 ? 'flex' : 'none';
    if (dom.alarmSubtext) dom.alarmSubtext.textContent = Number(d.risk) >= 85
      ? 'High review threshold reported by backend; prototype indicator, not an official warning.'
      : 'Elevated review threshold reported by backend; prototype indicator, not an official warning.';
  }

  if (dom.metricMoisture1) dom.metricMoisture1.textContent = fmt(d.moisture);
  if (dom.metricMoisture2) dom.metricMoisture2.textContent = fmt(d.moisture2);
  if (dom.metricVibration) dom.metricVibration.textContent = fmt(d.vibration, 2, '/10');
  if (dom.valAccelX) dom.valAccelX.textContent = fmt(d.accelX, 3);
  if (dom.valAccelY) dom.valAccelY.textContent = fmt(d.accelY, 3);
  if (dom.valAccelZ) dom.valAccelZ.textContent = fmt(d.accelZ, 3);
  if (dom.metricRainState) {
    dom.metricRainState.textContent = d.rain === null || d.rain === undefined ? 'N/A' : (Number(d.rain) ? 'WET' : 'DRY');
    dom.metricRainState.style.color = Number(d.rain) ? '#4a9ecc' : '#27ae60';
    if (dom.metricRainSub) dom.metricRainSub.textContent = d.rainRaw == null ? 'digital output' : `digital output · raw ${d.rainRaw}`;
  }
  if (dom.metricMic) dom.metricMic.textContent = fmt(d.micDbfs, 1, ' dBFS');
  if (dom.metricMicSub) dom.metricMicSub.textContent = `P-P ${fmt(d.micP2P, 0, ' ADC')} · ~${fmt(d.micFrequency, 0, ' Hz')}*`;
  if (dom.metricGps) dom.metricGps.textContent = d.gpsValid ? `${fmt(d.latitude, 5)}, ${fmt(d.longitude, 5)}` : 'NO FIX';
  if (dom.metricGpsSub) dom.metricGpsSub.textContent = `Satellites ${fmt(d.gpsSatellites, 0)} · HDOP ${fmt(d.gpsHdop, 1)}`;
  if (dom.metricConnectivity) dom.metricConnectivity.textContent = `${fmt(d.wifiPercent, 0, '%')} Wi-Fi`;
  if (dom.metricConnectivitySub) dom.metricConnectivitySub.textContent = `RSSI ${fmt(d.wifiRssi, 0, ' dBm')} · SIM ${d.simReady ? fmt(d.simPercent, 0, '%') : 'not ready'}`;

  if (dom.cardMoisture1) dom.cardMoisture1.className = `sensor-card ${Number(d.moisture) > 70 ? 'highlight' : ''}`;
  if (dom.cardMoisture2) dom.cardMoisture2.className = `sensor-card ${Number(d.moisture2) > 70 ? 'highlight' : ''}`;
  if (dom.cardRain) dom.cardRain.className = `sensor-card ${Number(d.rain) === 1 ? 'highlight' : ''}`;

  renderLogTable(isNewData);
  drawCanvasChart();
}

// --- Render Rolling Log Table (reverse chronological) ---
function renderLogTable(highlightNew = false) {
  if (!dom.sensorLogTbody) return;
  if (state.readings.length === 0) {
    dom.sensorLogTbody.innerHTML = `<tr><td colspan="12" class="empty-log-cell">Waiting for real ESP32 telemetry from <code>${state.apiBase}</code>. Use simulation only for UI testing.</td></tr>`;
    if (dom.logCountPill) dom.logCountPill.textContent = '0 readings';
    return;
  }
  if (dom.logCountPill) dom.logCountPill.textContent = `${state.readings.length} readings loaded`;
  const rowsHtml = [...state.readings].reverse().map((r, idx) => {
    const known = r.risk !== null && r.risk !== undefined && Number.isFinite(Number(r.risk));
    const riskCls = known ? classifyRisk(Number(r.risk)) : {label:'N/A',chipClass:'chip-med'};
    const gps = r.gpsValid ? `${fmt(r.latitude,5)}, ${fmt(r.longitude,5)}` : 'NO FIX';
    return `<tr class="${highlightNew && idx === 0 ? 'new-row' : ''}">
      <td><strong>${r.ts}</strong></td>
      <td><span class="risk-chip ${riskCls.chipClass}">${known ? `${Math.round(Number(r.risk))}% ${riskCls.label}` : 'N/A'}</span></td>
      <td>${fmt(r.moisture)} / ${fmt(r.s1Raw,0)}</td>
      <td>${fmt(r.moisture2)} / ${fmt(r.s2Raw,0)}</td>
      <td style="color:${Number(r.rain) ? '#4a9ecc' : '#526070'};font-weight:700">${r.rain == null ? 'N/A' : Number(r.rain) ? 'WET' : 'DRY'}</td>
      <td>${fmt(r.vibration,2)}</td>
      <td>${fmt(r.pitch,1)}° / ${fmt(r.roll,1)}°</td>
      <td>${fmt(r.micDbfs,1)}</td>
      <td>${fmt(r.micFrequency,0)}</td>
      <td>${gps}</td>
      <td>${fmt(r.wifiRssi,0,' dBm')}</td>
      <td>${r.simReady ? fmt(r.simPercent,0,'%') : 'OFFLINE'}</td>
    </tr>`;
  }).join('');
  dom.sensorLogTbody.innerHTML = rowsHtml;
}

// --- Draw Multi-Metric Chart on Canvas ---
function drawCanvasChart() {
  const canvas = dom.slopeTrendCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  const padLeft = 45;
  const padRight = 30;
  const padTop = 30;
  const padBottom = 35;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Background Grid Lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const y = padTop + (plotH / gridSteps) * i;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();

    // Axis label
    ctx.fillStyle = '#526070';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';

    let labelVal = '';
    if (state.chartMetric === 'risk') {
      labelVal = `${100 - i * 25}%`;
    } else if (state.chartMetric === 'moisture') {
      labelVal = `${100 - i * 25}%`;
    } else if (state.chartMetric === 'vibration') {
      labelVal = `${(2.0 - i * 0.5).toFixed(1)}`;
    } else if (state.chartMetric === 'pressure') {
      labelVal = `${Math.round(1025 - i * 15)}`;
    }
    ctx.fillText(labelVal, padLeft - 6, y + 3);
  }

  // Draw threshold lines for Risk metric (34% and 67%)
  if (state.chartMetric === 'risk') {
    const y34 = padTop + plotH - (34 / 100) * plotH;
    const y67 = padTop + plotH - (67 / 100) * plotH;

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
    ctx.beginPath();
    ctx.moveTo(padLeft, y34);
    ctx.lineTo(width - padRight, y34);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(227, 66, 52, 0.65)';
    ctx.beginPath();
    ctx.moveTo(padLeft, y67);
    ctx.lineTo(width - padRight, y67);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (state.readings.length === 0) {
    ctx.fillStyle = '#526070';
    ctx.font = '12px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Awaiting data stream from api.prahari.space...', width / 2, height / 2);
    return;
  }

  const pts = state.readings;
  const count = pts.length;
  const stepX = count > 1 ? plotW / (count - 1) : plotW;

  // Plot Line Function
  function plotSeries(color, valGetter, minRef, maxRef) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;

    for (let i = 0; i < count; i++) {
      const v = valGetter(pts[i]);
      const norm = Math.max(0, Math.min(1, (v - minRef) / (maxRef - minRef)));
      const x = padLeft + (i * stepX);
      const y = padTop + plotH - (norm * plotH);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // End point highlight
    const lastV = valGetter(pts[count - 1]);
    const lastNorm = Math.max(0, Math.min(1, (lastV - minRef) / (maxRef - minRef)));
    const lastX = padLeft + ((count - 1) * stepX);
    const lastY = padTop + plotH - (lastNorm * plotH);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw series based on selected metric
  if (state.chartMetric === 'risk') {
    plotSeries('#E34234', (d) => d.risk, 0, 100);
  } else if (state.chartMetric === 'moisture') {
    // S1 (Teal) and S2 (Ice Teal)
    plotSeries('#14B8A6', (d) => d.moisture, 0, 100);
    plotSeries('#5EEAD4', (d) => d.moisture2, 0, 100);
  } else if (state.chartMetric === 'vibration') {
    // Vibration magnitude scaled x100
    plotSeries('#F59E0B', (d) => d.vibration * 100, 0, 200);
  } else if (state.chartMetric === 'pressure') {
    plotSeries('#C084FC', (d) => d.pressure, 960, 1030);
  }

  // Bottom Time Ticks (Start & End)
  ctx.fillStyle = '#526070';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(pts[0].ts, padLeft, height - 12);
  ctx.textAlign = 'right';
  ctx.fillText(pts[count - 1].ts, width - padRight, height - 12);
}

// --- CSV Export Tool ---
function exportCsv() {
  if (state.readings.length === 0) { alert('No telemetry readings to export.'); return; }
  const headers = ['Timestamp','DeviceId','SampleId','RiskProbabilityPct','S1Pct','S1ADC','S2Pct','S2ADC','RainDetected','AccelX','AccelY','AccelZ','DynamicAccel','VibrationScore10','PitchDeg','RollDeg','MicPeakToPeakADC','MicDbfsEstimate','MicFrequencyHzEstimate','GPSValid','Latitude','Longitude','GPSSatellites','GPSHDOP','WiFiRSSIdBm','WiFiPercentEstimate','SIMSignalPercentEstimate','SIMReady'];
  const esc = v => `"${String(v ?? '').replaceAll('"','""')}"`;
  const rows = state.readings.map(r => [
    r.ts,r.deviceId,r.sampleId,r.risk,r.moisture,r.s1Raw,r.moisture2,r.s2Raw,r.rain,
    r.accelX,r.accelY,r.accelZ,r.dynamicAccel,r.vibration,r.pitch,r.roll,r.micP2P,
    r.micDbfs,r.micFrequency,r.gpsValid,r.latitude,r.longitude,r.gpsSatellites,r.gpsHdop,
    r.wifiRssi,r.wifiPercent,r.simPercent,r.simReady
  ].map(esc));
  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.map(esc).join(','), ...rows.map(row => row.join(','))].join('\n');
  const link = document.createElement('a');
  link.href = encodeURI(csvContent);
  link.download = `prahari_telemetry_${Date.now()}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// --- Simulation Mode Clock & Loop ---
function tickSimulator() {
  if (state.mode !== 'sim' || !state.sim.isRunning) return;

  state.sim.simTime.setSeconds(state.sim.simTime.getSeconds() + 1);
  if (dom.simTimeDisplay) {
    dom.simTimeDisplay.textContent = state.sim.simTime.toLocaleString();
  }

  // Jitter
  const jMoist = (Math.random() - 0.5) * 0.2;
  const jTilt = (Math.random() - 0.5) * 0.01;
  const jVib = (Math.random() - 0.5) * 2;

  state.sim.soilMoisture += (state.sim.targetMoisture - state.sim.soilMoisture) * 0.15 + jMoist;
  state.sim.tiltAngle += (state.sim.targetTilt - state.sim.tiltAngle) * 0.15 + jTilt;
  state.sim.vibration += (state.sim.targetVibration - state.sim.vibration) * 0.2 + jVib;

  // Add to readings buffer
  const sample = {
    ts: state.sim.simTime.toLocaleTimeString(),
    rawTs: Date.now(),
    moisture: state.sim.soilMoisture,
    moisture2: Math.max(0, state.sim.soilMoisture - 4.5),
    accelX: state.sim.accelX,
    accelY: state.sim.accelY,
    accelZ: state.sim.accelZ,
    accelMag: state.sim.accelMag,
    vibration: state.sim.vibration / 1000,
    rain: state.sim.rainState,
    humidity: state.sim.humidity,
    temp: state.sim.temperature,
    pressure: state.sim.baroPressure,
    risk: state.sim.riskScore,
    riskLabel: classifyRisk(state.sim.riskScore).label,
    confidence: state.sim.confidence,
    sampleId: 'SIM-' + Date.now().toString(36)
  };

  state.readings = [...state.readings.slice(-(state.historyLimit - 1)), sample];
  state.latest = sample;

  renderDashboard(false);
}

// --- Apply Mode Toggle ---
function setOperationMode(mode) {
  state.mode = mode;

  if (mode === 'live') {
    dom.btnModeLive.classList.add('active');
    dom.btnModeSim.classList.remove('active');
    dom.activeModeLabel.textContent = '🛰️ LIVE BACKEND MODE (api.prahari.space)';
    dom.liveConnectionBanner.style.display = 'flex';
    dom.simModeWarning.style.display = 'none';
    dom.simControlsCard.style.display = 'none';
    dom.manualTuningPanel.style.display = 'none';
    if (dom.heroBackendBadge) dom.heroBackendBadge.textContent = 'api.prahari.space';

    // Re-fetch history from live endpoint
    fetchHistory();
  } else {
    dom.btnModeSim.classList.add('active');
    dom.btnModeLive.classList.remove('active');
    dom.activeModeLabel.textContent = '🧪 SIMULATION SANDBOX (Custom Sliders & Scenarios)';
    dom.liveConnectionBanner.style.display = 'none';
    dom.simModeWarning.style.display = 'block';
    dom.simControlsCard.style.display = 'flex';
    dom.manualTuningPanel.style.display = 'block';
    if (dom.heroBackendBadge) dom.heroBackendBadge.textContent = 'SIMULATOR MODE';

    // Apply baseline
    applySimScenario('baseline');
  }
}

// --- Apply Simulation Scenario ---
function applySimScenario(key) {
  const sc = SCENARIOS[key];
  if (!sc) return;

  state.sim.scenario = key;
  state.sim.targetMoisture = sc.moisture;
  state.sim.soilMoisture = sc.moisture;
  state.sim.soilMoisture2 = sc.moisture2;
  state.sim.targetTilt = sc.tilt;
  state.sim.tiltAngle = sc.tilt;
  state.sim.accelX = sc.accelX;
  state.sim.accelY = sc.accelY;
  state.sim.accelZ = sc.accelZ;
  state.sim.targetVibration = sc.vibration;
  state.sim.vibration = sc.vibration;
  state.sim.humidity = sc.humidity;
  state.sim.temperature = sc.temp;
  state.sim.baroPressure = sc.pressure;
  state.sim.riskScore = sc.risk;
  state.sim.confidence = sc.confidence;
  state.sim.rainState = sc.rain;

  if (dom.sliderRainfall) dom.sliderRainfall.value = sc.rain ? 35 : 0;
  if (dom.sliderMoisture) dom.sliderMoisture.value = sc.moisture;
  if (dom.sliderTilt) dom.sliderTilt.value = sc.tilt;
  if (dom.sliderVibration) dom.sliderVibration.value = sc.vibration;
  syncSliderLabels();

  renderDashboard(true);
}

function syncSliderLabels() {
  if (dom.sliderRainfall && dom.valRainfall) dom.valRainfall.textContent = `${dom.sliderRainfall.value} mm/h`;
  if (dom.sliderMoisture && dom.valMoisture) dom.valMoisture.textContent = `${dom.sliderMoisture.value} %`;
  if (dom.sliderTilt && dom.valTilt) dom.valTilt.textContent = `${parseFloat(dom.sliderTilt.value).toFixed(2)} °`;
  if (dom.sliderVibration && dom.valVibration) dom.valVibration.textContent = `${dom.sliderVibration.value} mg`;
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Mode toggling
  if (dom.btnModeLive) dom.btnModeLive.addEventListener('click', () => setOperationMode('live'));
  if (dom.btnModeSim) dom.btnModeSim.addEventListener('click', () => setOperationMode('sim'));

  // Live polling toggle
  if (dom.togglePollingBtn) {
    dom.togglePollingBtn.addEventListener('click', () => {
      state.isPollingActive = !state.isPollingActive;
      if (dom.togglePollingIcon) dom.togglePollingIcon.innerHTML = state.isPollingActive ? '&#10074;&#10074;' : '&#9658;';
      if (dom.togglePollingText) dom.togglePollingText.textContent = state.isPollingActive ? 'Pause Feed' : 'Resume Feed';
    });
  }

  // Inject Test Packet
  if (dom.injectSampleBtn) {
    dom.injectSampleBtn.addEventListener('click', injectTestPacket);
  }

  // Chart Metric Tabs
  if (dom.chartTabs) {
    dom.chartTabs.forEach((tab) => {
      tab.addEventListener('click', (e) => {
        dom.chartTabs.forEach((t) => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.chartMetric = e.currentTarget.getAttribute('data-metric');
        
        const labels = {
          risk: 'Risk Score (%)',
          moisture: 'Soil Moisture 1 & 2 (% VWC)',
          vibration: 'Vibration / Accel Mag (x100)',
          pressure: 'Barometric Pressure (hPa)'
        };
        if (dom.activeChartTitle) dom.activeChartTitle.textContent = labels[state.chartMetric] || '';
        drawCanvasChart();
      });
    });
  }

  // Clear & Export
  if (dom.clearLogBtn) {
    dom.clearLogBtn.addEventListener('click', () => {
      state.readings = [];
      state.latest = null;
      renderDashboard();
    });
  }
  if (dom.exportCsvBtn) {
    dom.exportCsvBtn.addEventListener('click', exportCsv);
  }

  // Modal Dialog for API Endpoint
  if (dom.openApiSettingsBtn && dom.apiConfigModal) {
    dom.openApiSettingsBtn.addEventListener('click', () => {
      if (dom.inputApiEndpoint) dom.inputApiEndpoint.value = state.apiBase;
      dom.apiConfigModal.showModal();
    });
  }
  if (dom.closeApiModalBtn && dom.apiConfigModal) {
    dom.closeApiModalBtn.addEventListener('click', () => dom.apiConfigModal.close());
  }
  if (dom.saveApiEndpointBtn && dom.apiConfigModal) {
    dom.saveApiEndpointBtn.addEventListener('click', () => {
      let val = dom.inputApiEndpoint.value.trim();
      if (val.endsWith('/')) val = val.slice(0, -1);
      if (val) {
        state.apiBase = val;
        if (dom.displayApiEndpoint) dom.displayApiEndpoint.textContent = val;
        if (dom.emptyTableEndpoint) dom.emptyTableEndpoint.textContent = val;
        fetchHistory();
      }
      dom.apiConfigModal.close();
    });
  }
  if (dom.resetApiEndpointBtn) {
    dom.resetApiEndpointBtn.addEventListener('click', () => {
      state.apiBase = 'https://api.prahari.space';
      if (dom.inputApiEndpoint) dom.inputApiEndpoint.value = state.apiBase;
      if (dom.displayApiEndpoint) dom.displayApiEndpoint.textContent = state.apiBase;
      if (dom.emptyTableEndpoint) dom.emptyTableEndpoint.textContent = state.apiBase;
    });
  }

  // Simulator Scenario Buttons
  if (dom.scenarioBtns) {
    dom.scenarioBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        dom.scenarioBtns.forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const sc = e.currentTarget.getAttribute('data-scenario');
        applySimScenario(sc);
      });
    });
  }

  // Sliders
  if (dom.sliderRainfall) {
    dom.sliderRainfall.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      state.sim.rainState = v > 10 ? 1 : 0;
      syncSliderLabels();
      renderDashboard(true);
    });
  }
  if (dom.sliderMoisture) {
    dom.sliderMoisture.addEventListener('input', (e) => {
      state.sim.targetMoisture = parseFloat(e.target.value);
      state.sim.soilMoisture = state.sim.targetMoisture;
      state.sim.soilMoisture2 = Math.max(0, state.sim.soilMoisture - 4.5);
      syncSliderLabels();
      renderDashboard(true);
    });
  }
  if (dom.sliderTilt) {
    dom.sliderTilt.addEventListener('input', (e) => {
      state.sim.targetTilt = parseFloat(e.target.value);
      state.sim.tiltAngle = state.sim.targetTilt;
      syncSliderLabels();
      renderDashboard(true);
    });
  }
  if (dom.sliderVibration) {
    dom.sliderVibration.addEventListener('input', (e) => {
      state.sim.targetVibration = parseFloat(e.target.value);
      state.sim.vibration = state.sim.targetVibration;
      syncSliderLabels();
      renderDashboard(true);
    });
  }

  // Mobile Drawer
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileDrawer = document.getElementById('mobileDrawer');
  if (mobileMenuBtn && mobileDrawer) {
    mobileMenuBtn.addEventListener('click', () => {
      const isOpen = mobileDrawer.classList.toggle('open');
      mobileMenuBtn.setAttribute('aria-expanded', isOpen);
    });
    document.querySelectorAll('.mobile-nav-link').forEach((link) => {
      link.addEventListener('click', () => {
        mobileDrawer.classList.remove('open');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#' || targetId === '') return;
      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        const headerH = document.getElementById('navbar')?.offsetHeight || 70;
        const targetPos = targetEl.getBoundingClientRect().top + window.scrollY - headerH;
        window.scrollTo({ top: targetPos, behavior: 'smooth' });
      }
    });
  });

  // Resize canvas
  window.addEventListener('resize', () => {
    drawCanvasChart();
  });

  // Apple-style Scrollytelling
  initAppleScrollytelling();
}

// --- Apple-style Scrollytelling Controller ---
function initAppleScrollytelling() {
  const scrollySection = document.getElementById('scrollyShowcase');
  if (!scrollySection) return;

  const bgLayers = [
    document.getElementById('scrollyBg0'),
    document.getElementById('scrollyBg1'),
    document.getElementById('scrollyBg2'),
    document.getElementById('scrollyBg3')
  ];

  const cards = [
    document.getElementById('scrollyCard0'),
    document.getElementById('scrollyCard1'),
    document.getElementById('scrollyCard2'),
    document.getElementById('scrollyCard3')
  ];

  const dockBtns = document.querySelectorAll('.scrolly-dock-btn');
  const progressBar = document.getElementById('scrollyProgressBar');

  const hudSlopeAngle = document.getElementById('hudSlopeAngle');
  const hudGeology = document.getElementById('hudGeology');
  const hudState = document.getElementById('hudState');
  const scrollyHudTitle = document.getElementById('scrollyHudTitle');

  const hudData = [
    {
      title: 'STATION: CHOORALMALA RIDGE • 11.55°N 76.12°E',
      k1: 'SLOPE ANGLE', v1: '42.5° Incline',
      k2: 'GEOLOGY', v2: 'Lateritic Soil / Gneiss',
      k3: 'RADAR STATUS', v3: 'IMD ORANGE ALERT'
    },
    {
      title: 'NODE 01: ESP32 DUAL-CORE TELEMETRY MAST',
      k1: 'MCU CO-PROC', v1: 'Xtensa LX6 240MHz',
      k2: 'POWER SYSTEM', v2: '10W PV + 6Ah LiFePO4',
      k3: 'SLEEP CURRENT', v3: '~15 µA DEEP SLEEP'
    },
    {
      title: 'HYDROLOGY: DUAL-DEPTH PORE PRESSURE ARRAY',
      k1: 'PROBE S1', v1: '30 cm Influx Zone',
      k2: 'PROBE S2', v2: '80 cm Slip Plane',
      k3: 'SATURATION', v3: 'DYNAMIC GRADIENT'
    },
    {
      title: 'GEOMECHANICAL: ADXL345 TRIAXIAL MOTION',
      k1: 'TILT RESOLUTION', v1: '< 0.05° Angular Delta',
      k2: 'TREMOR BAND', v2: 'High-Freq Shear Spikes',
      k3: 'RISK SYNTHESIS', v3: 'RANDOM FOREST ENSEMBLE'
    }
  ];

  let currentStep = -1;
  let isTicking = false;

  function updateScrolly() {
    const rect = scrollySection.getBoundingClientRect();
    const totalScrollable = scrollySection.offsetHeight - window.innerHeight;

    if (totalScrollable <= 0) {
      isTicking = false;
      return;
    }

    const currentScroll = -rect.top;
    const progress = Math.max(0, Math.min(1, currentScroll / totalScrollable));

    // Update progress bar
    if (progressBar) {
      progressBar.style.width = `${Math.max(8, progress * 100)}%`;
    }

    // Determine active step index (0 to 3)
    let stepIndex = Math.floor(progress * 4);
    if (stepIndex > 3) stepIndex = 3;

    if (stepIndex !== currentStep) {
      currentStep = stepIndex;

      // Update background layers
      bgLayers.forEach((bg, idx) => {
        if (bg) {
          if (idx === currentStep) bg.classList.add('active');
          else bg.classList.remove('active');
        }
      });

      // Update cards
      cards.forEach((card, idx) => {
        if (card) {
          if (idx === currentStep) card.classList.add('active');
          else card.classList.remove('active');
        }
      });

      // Update dock buttons
      dockBtns.forEach((btn, idx) => {
        if (idx === currentStep) btn.classList.add('active');
        else btn.classList.remove('active');
      });

      // Update HUD
      const data = hudData[currentStep];
      if (data) {
        if (scrollyHudTitle) scrollyHudTitle.textContent = data.title;
        if (hudSlopeAngle) hudSlopeAngle.textContent = data.v1;
        if (hudGeology) hudGeology.textContent = data.v2;
        if (hudState) hudState.textContent = data.v3;
      }
    }

    isTicking = false;
  }

  window.addEventListener('scroll', () => {
    if (!isTicking) {
      requestAnimationFrame(updateScrolly);
      isTicking = true;
    }
  }, { passive: true });

  // Initial trigger
  updateScrolly();

  // Click on dock buttons to jump to slide
  dockBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const targetStep = parseInt(btn.getAttribute('data-target-step'), 10);
      const totalScrollable = scrollySection.offsetHeight - window.innerHeight;
      const targetScroll = scrollySection.offsetTop + (targetStep / 4) * totalScrollable + 20;
      window.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      });
    });
  });
}

// --- App Bootstrap ---
document.addEventListener('DOMContentLoaded', () => {
  initDom();
  setupEventListeners();

  // Initial render
  renderDashboard();

  // Start in Live Mode: Fetch history and start 3000ms polling loop
  fetchHistory();
  state.pollTimerId = setInterval(fetchLatest, state.pollIntervalMs);

  // Background simulation clock
  setInterval(tickSimulator, 1000);

  // 3D Folding Data Structure
  initFoldingDataStructure();

  // Feature Weights Dynamic Loader
  initFeatureWeightsLoader();

  // Week-by-Week Implementation Stepper
  initWeekTimelineController();
});


// ==========================================================================
// 3D FOLDING DATA STRUCTURE CONTROLLER
// ==========================================================================
function initFoldingDataStructure() {
  const wrapper = document.getElementById('foldingWrapper');
  const toggleBtn = document.getElementById('btnToggleAllFolds');
  const toggleText = document.getElementById('toggleFoldsText');
  const tabBtns = document.querySelectorAll('.fold-tab-btn');
  const panels = [
    document.getElementById('foldPanel0'),
    document.getElementById('foldPanel1'),
    document.getElementById('foldPanel2')
  ];

  if (!wrapper) return;

  let isFolded = false;

  // Toggle fold/unfold button
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      isFolded = !isFolded;
      if (isFolded) {
        wrapper.classList.add('folded');
        if (toggleText) toggleText.textContent = 'Unfold All Panels';
      } else {
        wrapper.classList.remove('folded');
        if (toggleText) toggleText.textContent = 'Fold Into 3D Compact';
      }
    });
  }

  // Fold tab buttons
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetIdx = parseInt(btn.getAttribute('data-fold-target'), 10);
      
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      panels.forEach((p, idx) => {
        if (!p) return;
        if (idx === targetIdx) {
          p.classList.add('highlighted');
          p.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
          p.classList.remove('highlighted');
        }
      });
    });
  });
}

// ==========================================================================
// FEATURE WEIGHT DISTRIBUTION DYNAMIC LOADER
// ==========================================================================
function initFeatureWeightsLoader() {
  const card = document.getElementById('rfFeatureCard');
  if (!card) return;

  const statusBadge = document.getElementById('rfStatusBadge');
  const statusText = document.getElementById('rfStatusText');
  const loadingIndicator = document.getElementById('rfLoadingIndicator');
  const loadingLabel = document.getElementById('rfLoadingLabel');
  const reloadBtn = document.getElementById('btnReloadWeights');
  const scenarioBtns = document.querySelectorAll('.rf-pill-btn');

  const barElements = {
    soil: { bar: document.getElementById('weightBarSoil'), val: document.getElementById('weightValSoil') },
    rain: { bar: document.getElementById('weightBarRain'), val: document.getElementById('weightValRain') },
    tilt: { bar: document.getElementById('weightBarTilt'), val: document.getElementById('weightValTilt') },
    vibration: { bar: document.getElementById('weightBarVib'), val: document.getElementById('weightValVib') },
    atmospheric: { bar: document.getElementById('weightBarAtm'), val: document.getElementById('weightValAtm') }
  };

  const SCENARIOS = {
    baseline: {
      name: 'Balanced Baseline',
      weights: { soil: 35, rain: 28, tilt: 22, vibration: 10, atmospheric: 5 },
      label: 'Calibrating baseline Gini splits across 100 Decision Trees...'
    },
    monsoon: {
      name: 'Heavy Monsoon Influx',
      weights: { soil: 42, rain: 32, tilt: 14, vibration: 8, atmospheric: 4 },
      label: 'Recalibrating for saturated pore pressure & peak 24h rainfall influx...'
    },
    shear: {
      name: 'Rapid Shear Creep',
      weights: { soil: 20, rain: 10, tilt: 40, vibration: 25, atmospheric: 5 },
      label: 'Weighting angular deformation velocity & high-frequency shear micro-tremors...'
    },
    seismic: {
      name: 'Micro-Tremor Focus',
      weights: { soil: 12, rain: 8, tilt: 35, vibration: 30, atmospheric: 15 },
      label: 'Amplifying triaxial acoustic vibration band & barometric storm gradient...'
    }
  };

  let currentScenario = 'baseline';
  let isCalibrating = false;

  function loadWeights(scenarioKey, animate = true) {
    if (isCalibrating) return;
    isCalibrating = true;
    currentScenario = scenarioKey;
    const scenario = SCENARIOS[scenarioKey] || SCENARIOS.baseline;

    // Set UI to loading state
    if (statusBadge) statusBadge.classList.add('loading');
    if (statusText) statusText.textContent = 'Calibrating Ensemble...';
    if (loadingIndicator) {
      loadingIndicator.classList.add('active');
      if (loadingLabel) loadingLabel.textContent = scenario.label;
    }

    // Zero out bars and values if animating
    if (animate) {
      Object.keys(barElements).forEach(k => {
        const item = barElements[k];
        if (item.bar) item.bar.style.width = '0%';
        if (item.val) item.val.textContent = '0%';
      });
    }

    // Simulate tree evaluation delay
    setTimeout(() => {
      const duration = 1200; // ms
      const startTime = performance.now();

      function stepCount(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        // Ease out cubic
        const ease = 1 - Math.pow(1 - progress, 3);

        Object.keys(scenario.weights).forEach(k => {
          const targetVal = scenario.weights[k];
          const currentVal = Math.round(ease * targetVal);
          const item = barElements[k];
          if (item) {
            if (item.val) item.val.textContent = `${currentVal}%`;
            if (item.bar) item.bar.style.width = `${ease * targetVal}%`;
          }
        });

        if (progress < 1) {
          requestAnimationFrame(stepCount);
        } else {
          // Finished loading
          if (statusBadge) statusBadge.classList.remove('loading');
          if (statusText) statusText.textContent = `✓ ${scenario.name} Loaded`;
          setTimeout(() => {
            if (loadingIndicator) loadingIndicator.classList.remove('active');
            isCalibrating = false;
          }, 400);
        }
      }

      requestAnimationFrame(stepCount);
    }, 450);
  }

  // Scenario Buttons
  scenarioBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      scenarioBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sc = btn.getAttribute('data-scenario');
      loadWeights(sc, true);
    });
  });

  // Reload button
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      loadWeights(currentScenario, true);
    });
  }

  // Trigger when scrolled into view
  if ('IntersectionObserver' in window) {
    let hasLoadedOnce = false;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !hasLoadedOnce) {
          hasLoadedOnce = true;
          loadWeights('baseline', true);
        }
      });
    }, { threshold: 0.25 });
    observer.observe(card);
  } else {
    loadWeights('baseline', false);
  }
}

// ==========================================================================
// WEEK-BY-WEEK TIMELINE STEPPER & TRANSITIONS
// ==========================================================================
function initWeekTimelineController() {
  const stepper = document.getElementById('weekTimelineStepper');
  if (!stepper) return;

  const btnPrev = document.getElementById('btnPrevWeek');
  const btnNext = document.getElementById('btnNextWeek');
  const btnAutoPlay = document.getElementById('btnAutoPlayWeek');
  const autoPlayIcon = document.getElementById('autoPlayIcon');
  const autoPlayText = document.getElementById('autoPlayText');

  const gaugeLabel = document.getElementById('weekGaugeLabel');
  const gaugePercent = document.getElementById('weekGaugePercent');
  const gaugeFill = document.getElementById('weekGaugeFill');

  const pillsContainer = document.getElementById('weekPillsScroll');
  const pills = pillsContainer ? pillsContainer.querySelectorAll('.week-pill') : [];
  const displayCard = document.getElementById('weekDisplayCard');

  const WEEK_MILESTONES = [
    {
      weekRange: 'WEEK 01',
      totalElapsedPct: 2.5,
      phaseBadge: 'PHASE 1: BENCH DEMO',
      status: 'VERIFIED ON BENCH',
      title: 'Breadboard Assembly & Sensor Bus Validation',
      desc: 'Assembling initial breadboard prototypes with ESP32 (Xtensa dual-core), ADXL345 digital accelerometer, DHT22 temperature/humidity, BMP180 barometric pressure, and dual capacitive moisture probes.',
      geotechTitle: 'HARDWARE & SIGNAL INTEGRITY',
      geotechDesc: 'Verification of clean 400 kHz I2C pullup signals and SPI transmission without line reflections. Static zero-drift testing on rigid granite testbench.',
      checklist: [
        'I2C bus scanned: ADXL345 at 0x53, BMP180 at 0x77',
        'Dual analog capacitive inputs calibrated in air (0%) and distilled water (100%)',
        'Hardware GPIO interrupt verified on tipping bucket rain counter',
        'Median filter algorithms validated against simulated mechanical noise'
      ],
      metrics: [
        { k: 'MCU Clock', v: '240 MHz / 80 MHz Edge' },
        { k: 'I2C Bus Rate', v: '400 kHz Fast-Mode' },
        { k: 'Sampling Rate', v: '1 Hz Continuous' },
        { k: 'Synthetic Packets', v: '5,000 / 0 Loss' }
      ],
      deliverables: 'Deliverables: Verified bench firmware, schematics, and sensor calibration curves'
    },
    {
      weekRange: 'WEEK 02',
      totalElapsedPct: 5.0,
      phaseBadge: 'PHASE 1: BENCH DEMO',
      status: 'POWER TUNING COMPLETED',
      title: 'Firmware Power Optimization & LiFePO4 Energy Profiling',
      desc: 'Tuning ESP32 deep-sleep modes, ULP co-processor wake stubs, and solar MPPT charging profile using a 10W monocrystalline PV panel and 6Ah LiFePO4 cell.',
      geotechTitle: 'OFF-GRID AUTONOMY & DISCHARGE MARGIN',
      geotechDesc: 'Bench simulation of 7 consecutive monsoon overcast days (solar irradiance < 50 W/m²). Testing brownout protection and non-volatile flash wear leveling.',
      checklist: [
        'Deep sleep current measured: 14.8 µA quiescent current',
        'Wakeup interrupt triggers reliably on tilt delta (> 0.1° / 100ms)',
        'Solar MPPT charging cycle verified at 3.65V cutoff',
        'Battery runtime projected: 21 days with zero solar irradiance'
      ],
      metrics: [
        { k: 'Sleep Current', v: '14.8 µA' },
        { k: 'Active TX Pulse', v: '110 mA @ 48ms' },
        { k: 'Solar Harvest', v: '10W Monocrystalline' },
        { k: 'Battery Life', v: '6,000 mAh LiFePO4' }
      ],
      deliverables: 'Deliverables: Power consumption trace, battery discharge model, low-power sleep firmware'
    },
    {
      weekRange: 'WEEK 03',
      totalElapsedPct: 7.5,
      phaseBadge: 'PHASE 2: CONTROLLED FIELD TEST',
      status: 'FABRICATION READY',
      title: 'IP66 Enclosure Fabrication & Soil Infiltration Bench Calibration',
      desc: 'Packaging the ESP32 node inside an IP66 UV-stabilized polycarbonate enclosure with Gore-Tex pressure equilibrium vents and sealed waterproof cable glands for dual subsurface probes.',
      geotechTitle: 'PORE-PRESSURE SIMULATION COLUMNS',
      geotechDesc: 'Testing capacitive probes inside 1-meter high soil columns of lateritic clay and saprolite gravel to quantify dielectric response to artificial rainfall infiltration.',
      checklist: [
        'IP66 immersion and high-pressure water spray test passed',
        'Gore-Tex vent prevents internal condensation during rapid temperature drops',
        'Dual soil moisture probes (30 cm & 80 cm) calibrated in packed laterite',
        'ADXL345 mounted on rigid aluminum mounting plate with thermal isolation'
      ],
      metrics: [
        { k: 'Enclosure Rating', v: 'IP66 Certified' },
        { k: 'Probe Depths', v: '30 cm & 80 cm' },
        { k: 'Internal Temp', v: '+2.1°C Ambient Offset' },
        { k: 'Cable Seal', v: 'PG9 Waterproof Gland' }
      ],
      deliverables: 'Deliverables: Physical weatherproof enclosure, soil column calibration dataset'
    },
    {
      weekRange: 'WEEK 04',
      totalElapsedPct: 10.0,
      phaseBadge: 'PHASE 2: CONTROLLED FIELD TEST',
      status: 'TESTBED ACTIVE',
      title: 'Controlled Hillside Testbed Deployment (Mast 01)',
      desc: 'Deploying Node 01 on a secure, uninhabited natural slope testbed along the Western Ghats escarpment. Ground mast anchored into bedrock with tensioned stainless guy-wires.',
      geotechTitle: 'SLOPE PROFILE: 42° LATERITIC INCLINE',
      geotechDesc: 'Baseline environmental monitoring under natural open-air conditions. Checking solar orientation against high hill ridges and morning valley fog.',
      checklist: [
        'Ground mast mechanically anchored with 3 stainless guy-wires',
        'Solar panel oriented 15° South-Southwest for maximum ridge harvest',
        'Dual probes inserted into undisturbed soil horizon via auger core',
        'First live telemetry packet received over test cellular gateway'
      ],
      metrics: [
        { k: 'Slope Incline', v: '42.5° Incline' },
        { k: 'Solar Azimuth', v: '195° SSW' },
        { k: 'Elevation', v: '840m MSL' },
        { k: 'Packet Success', v: '99.4% (First 24h)' }
      ],
      deliverables: 'Deliverables: Field installation photo-log, initial 24-hour continuous slope baseline'
    },
    {
      weekRange: 'WEEK 05',
      totalElapsedPct: 12.5,
      phaseBadge: 'PHASE 2: CONTROLLED FIELD TEST',
      status: 'DATA STREAM ACTIVE',
      title: '30-Day Diurnal Drift & Noise Baseline Recording',
      desc: 'Collecting unbroken telemetry over 30 days to measure natural thermal expansion, daily tilt drift caused by sun exposure, and baseline soil moisture evaporation cycles.',
      geotechTitle: 'THERMAL TILT CORRECTION FILTERING',
      geotechDesc: 'Characterizing diurnal temperature swings (18°C night to 36°C afternoon) on ADXL345 output to prevent false angular deformation alerts.',
      checklist: [
        '30-day continuous dataset logged without node resets',
        'Temperature compensation coefficient calculated: 0.008° / °C',
        'Subsurface moisture probe S2 (80 cm) shows high stability (< 1.5% daily drift)',
        'Wind gust vibration signatures isolated via high-pass FFT filter'
      ],
      metrics: [
        { k: 'Total Uptime', v: '720 Hours Continuous' },
        { k: 'Diurnal Drift', v: '±0.04° Max (Thermal)' },
        { k: 'Packets Received', v: '43,200 Packets' },
        { k: 'Packet Loss', v: '< 0.15%' }
      ],
      deliverables: 'Deliverables: 30-day thermal drift report, calibrated digital filter coefficients'
    },
    {
      weekRange: 'WEEK 06',
      totalElapsedPct: 15.0,
      phaseBadge: 'PHASE 2: CONTROLLED FIELD TEST',
      status: 'NETWORK INTEGRATED',
      title: 'LoRa Mesh Gateway & Edge-to-Cloud Bridge Link',
      desc: 'Connecting Node 01 to a solar-powered LoRa gateway stationed at the local Gram Panchayat ridge. Deploying fallback HTTP/MQTT pipelines to api.prahari.space.',
      geotechTitle: 'LOW-POWER TELEMETRY RELIABILITY',
      geotechDesc: 'Testing RF propagation across heavy jungle foliage and monsoon rain attenuation (2.4 km line-of-sight path from ridge to village hall).',
      checklist: [
        'LoRa 865–867 MHz band link verified: RSSI -88 dBm, SNR +9.5 dB',
        'Automatic retry and packet queuing implemented in ESP32 SPI flash',
        'Cloud bridge ingest verified at https://api.prahari.space/api/latest',
        'End-to-end telemetry latency measured at 620 ms'
      ],
      metrics: [
        { k: 'LoRa Range', v: '2.4 km Through Canopy' },
        { k: 'RSSI Signal', v: '-88 dBm (Strong)' },
        { k: 'Bridge Protocol', v: 'MQTT / HTTPS' },
        { k: 'Payload Size', v: '32 Bytes Packed' }
      ],
      deliverables: 'Deliverables: LoRa coverage heatmap, gateway configuration guide, cloud API bridge'
    },
    {
      weekRange: 'WEEK 07',
      totalElapsedPct: 17.5,
      phaseBadge: 'PHASE 2: CONTROLLED FIELD TEST',
      status: 'DASHBOARD VERIFIED',
      title: 'Village Dashboard Offline-First & Mobile Accessibility Test',
      desc: 'Benchmarking the responsive village web dashboard on entry-level smartphones over low-bandwidth 2G/3G rural networks and local offline Wi-Fi hotspots.',
      geotechTitle: 'ACCESSIBLE COMMUNITY VISUALIZATION',
      geotechDesc: 'User experience testing with local volunteers: Ensuring the 0–100 risk score, advisory review tiers, and trend charts load in under 1.5 seconds on 3G.',
      checklist: [
        'Total page weight compressed to < 85 KB (instant mobile rendering)',
        'Dual-mode toggle verified: Live Backend Polling vs Simulator Mode',
        'Color contrast verified for bright sunlight outdoor viewing',
        'CSV telemetry export verified on Android browsers'
      ],
      metrics: [
        { k: 'Page Load (3G)', v: '1.24 Seconds' },
        { k: 'Total Asset Size', v: '< 85 KB Compressed' },
        { k: 'Screen Support', v: '320px to 4K Ultrawide' },
        { k: 'Offline Storage', v: 'IndexedDB / LocalStorage' }
      ],
      deliverables: 'Deliverables: Responsive mobile web dashboard, local offline cache manifest'
    },
    {
      weekRange: 'WEEK 08',
      totalElapsedPct: 20.0,
      phaseBadge: 'PHASE 2: CONTROLLED FIELD TEST',
      status: 'AUDIT COMPLETE',
      title: 'Pre-Monsoon Comprehensive System Audit & Inclinometer Zeroing',
      desc: 'Performing full physical inspection of Mast 01 prior to onset of southwest monsoon. Retightening guy-wires, re-zeroing baseline inclinometers, and testing rain gauge bucket.',
      geotechTitle: 'PRE-MONSOON SLOPE EQUILIBRIUM ZEROING',
      geotechDesc: 'Establishing final calibrated zero-datum coordinates for shear displacement, soil pore saturation, and local IMD advisory cross-referencing.',
      checklist: [
        'Tipping bucket funnels cleared of leaves and organic debris',
        'ADXL345 tilt angles zeroed to high-precision reference datum',
        'LiFePO4 battery pack healthy at 3.42V resting potential',
        'All seals and cable glands inspected for silicone gasket integrity'
      ],
      metrics: [
        { k: 'Tilt Zero Datum', v: '0.000° Offset Calibrated' },
        { k: 'Rain Calibration', v: '0.20 mm / Tip Exact' },
        { k: 'Enclosure Seal', v: 'Zero Moisture Ingress' },
        { k: 'Phase 2 Outcome', v: '100% Pass Rate' }
      ],
      deliverables: 'Deliverables: Pre-monsoon inspection certificate, baseline zero calibration record'
    },
    {
      weekRange: 'WEEKS 09–12',
      totalElapsedPct: 30.0,
      phaseBadge: 'PHASE 3: 3-SLOPE PILOT',
      status: 'MULTI-SITE ACTIVE',
      title: '3-Slope Triangulation Mast Deployment (Road-cut, Terraced, Forest)',
      desc: 'Fabricating and installing 3 dedicated sensor nodes across distinct geotechnical risk profiles: Slope A (Steep road-cut with exposed gneiss), Slope B (Agricultural terraced tea plantation), and Slope C (Dense forest natural embankment).',
      geotechTitle: 'COMPARATIVE HYDRO-GEOMECHANICAL TYPOLOGY',
      geotechDesc: 'Analyzing how different root vegetation structures and drainage cuts alter the infiltration rate and slip plane depth across the 3 test sites.',
      checklist: [
        '3 complete hardware nodes deployed and connected to LoRa mesh',
        'Site A (Road-cut): 48° slope angle with exposed fracture planes',
        'Site B (Terrace): 34° slope with high surface runoff retention',
        'Site C (Forest): 41° slope with deep tree root reinforcement',
        'Mesh repeater established to ensure 100% telemetry coverage'
      ],
      metrics: [
        { k: 'Active Nodes', v: '3 Multi-Modal Masts' },
        { k: 'Total Sensors', v: '24 Synchronized Channels' },
        { k: 'Mesh Coverage', v: '4.8 km² Terrain' },
        { k: 'Data Frequency', v: '60s Synchronized Sync' }
      ],
      deliverables: 'Deliverables: 3-site comparative terrain model, multi-node mesh topology map'
    },
    {
      weekRange: 'WEEKS 13–16',
      totalElapsedPct: 40.0,
      phaseBadge: 'PHASE 3: 3-SLOPE PILOT',
      status: 'COMMUNITY ENGAGED',
      title: 'Panchayat Volunteer Orientation & Readiness Drills',
      desc: 'Conducting community workshops with Gram Panchayat disaster management committees, Kudumbashree volunteers, and local civil defense teams. Demonstrating the 60% Advisory and 85% Critical Review tiers.',
      geotechTitle: 'HUMAN-IN-THE-LOOP PREPAREDNESS PROTOCOL',
      geotechDesc: 'Establishing clear community action checklists (inspecting drainage culverts, monitoring road culvert overflow) strictly without issuing unauthorized evacuation orders.',
      checklist: [
        'Conducted 3 interactive workshops with 65 village volunteers',
        'Demonstrated dashboard interpretations and Malayalam advisory text',
        'Established village feedback log for dashboard usability',
        'Reiterated strict safety boundary: system does NOT issue evacuation orders'
      ],
      metrics: [
        { k: 'Volunteers Trained', v: '65 Community Members' },
        { k: 'Usability Score', v: '94% Comprehension' },
        { k: 'Feedback Points', v: '18 Actionable Updates' },
        { k: 'Safety Compliance', v: 'Strict IMD Protocol' }
      ],
      deliverables: 'Deliverables: Community training handbook (Malayalam/English), workshop log'
    },
    {
      weekRange: 'WEEKS 17–24',
      totalElapsedPct: 60.0,
      phaseBadge: 'PHASE 3: 3-SLOPE PILOT',
      status: 'MONSOON STRESS-TEST',
      title: 'Peak Monsoon Influx & Pore-Water Creep Tracking',
      desc: 'Real-time telemetry stress-testing throughout the peak southwest monsoon. Monitoring intense rainfall bursts (> 60 mm/hr) and tracking the rate of pore-water saturation gradient between Probe S1 (30 cm) and Probe S2 (80 cm).',
      geotechTitle: 'SATURATION SPIKES & MICRO-SHEAR VIBRATIONS',
      geotechDesc: 'Capturing non-linear correlations during intense precipitation events. Recording micro-tremor acceleration spikes corresponding to heavy debris runoffs.',
      checklist: [
        'Captured 1,280 mm cumulative rainfall across 8 peak monsoon weeks',
        'Monitored 4 intense rain spells with rainfall rates exceeding 55 mm/hr',
        'Zero node hardware water ingress across 100% of deployed stations',
        'Recorded transient pore pressure saturation spikes reaching 92% VWC'
      ],
      metrics: [
        { k: 'Cumulative Rain', v: '1,280 mm Recorded' },
        { k: 'Max Rain Rate', v: '68 mm / hour' },
        { k: 'Pore Saturation', v: 'Peak 92.4% VWC' },
        { k: 'System Uptime', v: '99.82% During Storms' }
      ],
      deliverables: 'Deliverables: Monsoon precipitation & pore-water correlation dataset, event log'
    },
    {
      weekRange: 'WEEKS 25–40',
      totalElapsedPct: 100.0,
      phaseBadge: 'PHASE 4: EVIDENCE REVIEW',
      status: 'SDMA REVIEW SUBMITTED',
      title: 'Geotechnical Evidence Inversion, Model Calibration & SDMA Review',
      desc: 'Synthesizing the complete empirical dataset. Re-training and tuning the Random Forest classifier feature weights against verified ground movements and official IMD/SDMA records.',
      geotechTitle: 'SCIENTIFIC VALIDATION & THRESHOLD CALIBRATION',
      geotechDesc: 'Measuring receiver operating characteristics (ROC-AUC), evaluating false positive rates, and presenting formal research findings to State Disaster Management Authorities and academic institutions.',
      checklist: [
        'Calibrated Random Forest feature weights: Soil 35%, Rain 28%, Tilt 22%, Vib 10%, Atm 5%',
        'Reduced synthetic false alert triggers by 64% using multi-variable tree gating',
        'Compiled 140-page academic pilot evaluation and field data treatise',
        'Submitted transparent methodology and limitations report to SDMA officials'
      ],
      metrics: [
        { k: 'Total Packets', v: '518,400 Telemetry Frames' },
        { k: 'Model Tuning', v: '100 Trees Calibrated' },
        { k: 'False Trigger Red.', v: '-64% Reduction' },
        { k: 'Review Status', v: 'Academic Review Complete' }
      ],
      deliverables: 'Deliverables: Final peer-reviewed research report, calibrated geotechnical threshold guide'
    }
  ];

  let currentWeekIdx = 0;
  let autoPlayTimer = null;
  let isAutoPlaying = false;

  function renderWeek(index, direction = 'next') {
    if (index < 0) index = 0;
    if (index >= WEEK_MILESTONES.length) index = WEEK_MILESTONES.length - 1;
    currentWeekIdx = index;
    const m = WEEK_MILESTONES[currentWeekIdx];

    // Update gauge
    if (gaugeLabel) gaugeLabel.textContent = `${m.weekRange} OF 40 • ${m.phaseBadge}`;
    if (gaugePercent) gaugePercent.textContent = `${m.totalElapsedPct}% Complete`;
    if (gaugeFill) gaugeFill.style.width = `${m.totalElapsedPct}%`;

    // Update pills
    pills.forEach((p, idx) => {
      if (idx === currentWeekIdx) {
        p.classList.add('active');
        p.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } else {
        p.classList.remove('active');
      }
    });

    // 3D Folding Transition on Card
    if (displayCard) {
      displayCard.classList.remove('fade-in');
      displayCard.classList.add(direction === 'next' ? 'fade-out-left' : 'fade-out-right');

      setTimeout(() => {
        // Build card HTML
        const checklistHtml = m.checklist.map(item => `
          <li>
            <span class="check-icon">&#10003;</span>
            <span>${item}</span>
          </li>
        `).join('');

        const metricsHtml = m.metrics.map(met => `
          <div class="telemetry-metric-row">
            <span class="metric-k">${met.k}</span>
            <span class="metric-v">${met.v}</span>
          </div>
        `).join('');

        displayCard.innerHTML = `
          <div class="week-card-top">
            <div class="week-badge-group">
              <span class="week-num-badge">${m.weekRange}</span>
              <span class="week-phase-badge">${m.phaseBadge}</span>
            </div>
            <span class="week-status-pill">${m.status}</span>
          </div>

          <div class="week-card-grid">
            <div class="week-info-col">
              <h4>${m.title}</h4>
              <p>${m.desc}</p>

              <div class="week-geotech-box">
                <span class="box-title">${m.geotechTitle}</span>
                <p>${m.geotechDesc}</p>
              </div>

              <ul class="week-checklist">
                ${checklistHtml}
              </ul>
            </div>

            <div class="week-telemetry-col">
              <div class="telemetry-box-header">
                <span>HARDWARE &amp; TELEMETRY TARGETS</span>
                <span>40-WEEK PILOT</span>
              </div>
              <div class="telemetry-metrics-list">
                ${metricsHtml}
              </div>
              <div class="week-deliverables-pill">
                <strong>${m.deliverables}</strong>
              </div>
            </div>
          </div>
        `;

        displayCard.classList.remove('fade-out-left', 'fade-out-right');
        displayCard.classList.add('fade-in');
      }, 220);
    }
  }

  // Navigation handlers
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      stopAutoPlay();
      if (currentWeekIdx > 0) renderWeek(currentWeekIdx - 1, 'prev');
      else renderWeek(WEEK_MILESTONES.length - 1, 'prev');
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      stopAutoPlay();
      if (currentWeekIdx < WEEK_MILESTONES.length - 1) renderWeek(currentWeekIdx + 1, 'next');
      else renderWeek(0, 'next');
    });
  }

  // Pill click handlers
  pills.forEach((pill, idx) => {
    pill.addEventListener('click', () => {
      stopAutoPlay();
      const dir = idx >= currentWeekIdx ? 'next' : 'prev';
      renderWeek(idx, dir);
    });
  });

  // Auto-play progression
  function startAutoPlay() {
    isAutoPlaying = true;
    if (autoPlayIcon) autoPlayIcon.textContent = '⏸';
    if (autoPlayText) autoPlayText.textContent = 'Pause Progression';
    if (btnAutoPlay) btnAutoPlay.classList.add('active');

    autoPlayTimer = setInterval(() => {
      const nextIdx = (currentWeekIdx + 1) % WEEK_MILESTONES.length;
      renderWeek(nextIdx, 'next');
    }, 3800);
  }

  function stopAutoPlay() {
    isAutoPlaying = false;
    if (autoPlayTimer) clearInterval(autoPlayTimer);
    autoPlayTimer = null;
    if (autoPlayIcon) autoPlayIcon.textContent = '▶';
    if (autoPlayText) autoPlayText.textContent = 'Auto-Play Weeks';
    if (btnAutoPlay) btnAutoPlay.classList.remove('active');
  }

  if (btnAutoPlay) {
    btnAutoPlay.addEventListener('click', () => {
      if (isAutoPlaying) stopAutoPlay();
      else startAutoPlay();
    });
  }

  // Initial render
  renderWeek(0, 'next');
}
