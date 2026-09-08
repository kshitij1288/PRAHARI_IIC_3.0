import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ─── PRAHARI API ──────────────────────────────────────────────────────────────
// Change this only if you deploy the API somewhere else.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://api.prahari.space";
const POLL_MS = 3000;
const MAX_HISTORY = 40;
const MAX_LOG = 100;

function normalizeApiReading(item) {
  if (!item) return null;
  return {
    ts: item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
    moisture: Number(item.s1_pct ?? item.moisture ?? 0),
    moisture2: Number(item.s2_pct ?? 0),
    accelX: Number(item.accel_x ?? item.accelX ?? 0),
    accelY: Number(item.accel_y ?? item.accelY ?? 0),
    accelZ: Number(item.accel_z ?? item.accelZ ?? 9.81),
    accelMag: Number(item.vibration ?? item.accelMag ?? 0),
    rain: Number(item.rain_detected ?? item.rain ?? 0),
    humidity: Number(item.dht_humidity ?? item.humidity ?? 0),
    pressure: Number(item.bmp_pressure ?? item.pressure ?? 0),
    temp: Number(item.dht_temp ?? item.temp ?? 0),
    risk: Number(item.risk_score ?? item.risk ?? 0),
    riskLabel: item.risk_label ?? item.risk_level ?? "",
    confidence: Number(item.confidence ?? 0),
    sampleId: item.sample_id ?? "",
  };
}

function riskLabel(score) {
  if (score < 34) return { label: "LOW", color: "#27AE60", bg: "rgba(39,174,96,0.12)", border: "rgba(39,174,96,0.3)" };
  if (score < 67) return { label: "MEDIUM", color: "#E67E22", bg: "rgba(230,126,34,0.12)", border: "rgba(230,126,34,0.3)" };
  return { label: "HIGH", color: "#E74C3C", bg: "rgba(231,76,60,0.12)", border: "rgba(231,76,60,0.3)" };
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  page: {
    fontFamily: "'Space Grotesk', 'Inter', sans-serif",
    background: "#0D1821",
    color: "#E8EDF3",
    minHeight: "100vh",
    padding: "0",
  },
  nav: {
    background: "rgba(13,24,33,0.95)",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    padding: "14px 28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    position: "sticky",
    top: 0,
    zIndex: 50,
  },
  navLogo: { fontWeight: 700, fontSize: 18, letterSpacing: "0.1em", color: "#F0A500" },
  navRight: { display: "flex", alignItems: "center", gap: 16 },
  liveBadge: (alive) => ({
    display: "flex", alignItems: "center", gap: 7,
    fontSize: 12, fontWeight: 600,
    background: alive ? "rgba(39,174,96,0.12)" : "rgba(100,100,100,0.12)",
    color: alive ? "#27AE60" : "#666",
    border: `1px solid ${alive ? "rgba(39,174,96,0.3)" : "rgba(100,100,100,0.2)"}`,
    padding: "4px 12px", borderRadius: 20,
  }),
  dot: (alive) => ({
    width: 7, height: 7, borderRadius: "50%",
    background: alive ? "#27AE60" : "#555",
    boxShadow: alive ? "0 0 0 3px rgba(39,174,96,0.25)" : "none",
    animation: alive ? "pulseDot 1.8s ease-out infinite" : "none",
  }),
  body: { padding: "24px 28px", display: "flex", flexDirection: "column", gap: 20 },

  // risk banner
  banner: (r) => ({
    borderRadius: 10,
    border: `1px solid ${r.border}`,
    background: r.bg,
    padding: "20px 28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  }),
  bannerLeft: { display: "flex", alignItems: "center", gap: 20 },
  bannerScore: (r) => ({ fontSize: 52, fontWeight: 700, color: r.color, lineHeight: 1 }),
  bannerMeta: {},
  bannerLabel: (r) => ({
    fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
    color: r.color, marginBottom: 4,
  }),
  bannerTitle: { fontSize: 20, fontWeight: 700, color: "#E8EDF3" },
  bannerSub: { fontSize: 13, color: "#8DA3BA", marginTop: 4 },

  // sensor grid
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 },
  card: (hi) => ({
    background: hi ? "rgba(240,165,0,0.06)" : "#1A2D42",
    border: `1px solid ${hi ? "rgba(240,165,0,0.2)" : "rgba(255,255,255,0.07)"}`,
    borderRadius: 10, padding: "18px 16px",
  }),
  cardIcon: { fontSize: 20, marginBottom: 10 },
  cardLabel: { fontSize: 11, color: "#526070", fontWeight: 600, marginBottom: 4, letterSpacing: "0.04em" },
  cardVal: (color) => ({ fontSize: 26, fontWeight: 700, color: color || "#E8EDF3", lineHeight: 1 }),
  cardUnit: { fontSize: 12, color: "#8DA3BA", marginTop: 3 },

  // chart section
  chartBox: {
    background: "#111D2C",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 10, padding: "20px 20px 12px",
  },
  chartTitle: { fontSize: 13, fontWeight: 600, color: "#8DA3BA", marginBottom: 16, letterSpacing: "0.04em" },

  // log
  logBox: {
    background: "#111D2C",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 10,
    overflow: "hidden",
  },
  logHeader: {
    padding: "14px 20px",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    display: "flex", alignItems: "center", justifyContent: "space-between",
  },
  logTitle: { fontSize: 13, fontWeight: 600, color: "#8DA3BA", letterSpacing: "0.04em" },
  logCount: { fontSize: 11, color: "#526070" },
  tableWrap: { overflowX: "auto", maxHeight: 260, overflowY: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: {
    padding: "8px 14px", textAlign: "left", fontWeight: 600,
    color: "#526070", borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "#0D1821", position: "sticky", top: 0, letterSpacing: "0.04em",
  },
  td: (alt) => ({
    padding: "7px 14px", color: "#C5D2DF",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    background: alt ? "rgba(255,255,255,0.015)" : "transparent",
  }),
  tdRisk: (r) => ({
    padding: "7px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    fontWeight: 700, color: r.color, fontSize: 11,
    letterSpacing: "0.06em",
  }),
};

// ─── TOOLTIP ──────────────────────────────────────────────────────────────────
const CustomTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1A2D42", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "#526070", marginBottom: 6 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ fontSize: 13, color: p.color, fontWeight: 600 }}>
          {p.name}: {p.value}
          {p.name === "Risk" ? "%" : p.name === "Moisture" ? "%" : p.name === "Pressure" ? " hPa" : ""}
        </div>
      ))}
    </div>
  );
};


// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function PrahariDashboard() {
  const [readings, setReadings] = useState([]);
  const [live, setLive] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("risk");

  const fetchLatest = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/latest`, { cache: "no-store" });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      const r = normalizeApiReading(data.latest);
      setConnected(true);
      setError("");

      if (r) {
        setReadings(prev => {
          const last = prev[prev.length - 1];
          if (last && r.sampleId && String(last.sampleId) === String(r.sampleId)) return prev;
          return [...prev.slice(-(MAX_HISTORY - 1)), r];
        });
      }
    } catch (e) {
      setConnected(false);
      setError("Backend unavailable");
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/history?limit=${MAX_HISTORY}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      const parsed = (data.data || []).map(normalizeApiReading).filter(Boolean);
      setReadings(parsed.slice(-MAX_HISTORY));
      setConnected(true);
      setError("");
    } catch (e) {
      setConnected(false);
      setError("Waiting for PRAHARI backend");
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(fetchLatest, POLL_MS);
    return () => clearInterval(id);
  }, [live, fetchLatest]);

  const latest = readings[readings.length - 1] || {
    ts: "--", moisture: 0, moisture2: 0, accelX: 0, accelY: 0, accelZ: 0,
    accelMag: 0, rain: 0, humidity: 0, pressure: 0, temp: 0, risk: 0,
    confidence: 0, sampleId: ""
  };

  const risk = riskLabel(latest.risk);

  const chartData = readings.map(r => ({
    ts: r.ts,
    Risk: r.risk,
    Moisture: r.moisture,
    "Accel Mag": +(r.accelMag * 100).toFixed(1),
    Pressure: r.pressure,
  }));

  const chartConfig = {
    risk: { key: "Risk", color: "#E74C3C", label: "Risk Score (%)" },
    moisture: { key: "Moisture", color: "#4A9ECC", label: "Soil Moisture (%)" },
    accel: { key: "Accel Mag", color: "#F0A500", label: "Vibration ×100" },
    pressure: { key: "Pressure", color: "#9B59B6", label: "Pressure (hPa)" },
  }[tab];

  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
        @keyframes pulseDot { 0%{box-shadow:0 0 0 0 rgba(39,174,96,0.5)} 100%{box-shadow:0 0 0 8px rgba(39,174,96,0)} }
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#243750;border-radius:4px}
        * { box-sizing: border-box; }
      `}</style>

      <nav style={S.nav}>
        <div style={S.navLogo}>PRAHARI</div>
        <div style={S.navRight}>
          <div style={S.liveBadge(connected && live)}>
            <div style={S.dot(connected && live)} />
            {connected && live ? "LIVE — ESP32 Feed" : error || "OFFLINE"}
          </div>
          <button
            onClick={() => setLive(v => !v)}
            style={{
              background: live ? "rgba(231,76,60,0.12)" : "rgba(39,174,96,0.12)",
              color: live ? "#E74C3C" : "#27AE60",
              border: `1px solid ${live ? "rgba(231,76,60,0.3)" : "rgba(39,174,96,0.3)"}`,
              borderRadius: 8, padding: "5px 14px",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            {live ? "Pause" : "Resume"}
          </button>
        </div>
      </nav>

      <div style={S.body}>
        <div style={S.banner(risk)}>
          <div style={S.bannerLeft}>
            <div style={S.bannerScore(risk)}>{latest.risk}%</div>
            <div style={S.bannerMeta}>
              <div style={S.bannerLabel(risk)}>RISK LEVEL</div>
              <div style={S.bannerTitle}>
                {risk.label === "LOW" ? "Stable Conditions" : risk.label === "MEDIUM" ? "Elevated Conditions" : "Critical — Alert Active"}
              </div>
              <div style={S.bannerSub}>
                Last reading: {latest.ts} &nbsp;·&nbsp; {readings.length} readings loaded
                {latest.confidence ? ` · AI confidence ${latest.confidence}%` : ""}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            {risk.label === "HIGH" && <div style={{ fontSize: 22, animation: "pulseDot 1s ease-out infinite" }}>🚨</div>}
            <div style={{ fontSize: 11, color: "#526070" }}>IIC — MUJ</div>
          </div>
        </div>

        <div style={S.grid}>
          <div style={S.card(latest.moisture > 70)}>
            <div style={S.cardIcon}>💧</div>
            <div style={S.cardLabel}>SOIL MOISTURE 1</div>
            <div style={S.cardVal(latest.moisture > 70 ? "#E74C3C" : latest.moisture > 45 ? "#E67E22" : "#27AE60")}>{latest.moisture.toFixed(1)}</div>
            <div style={S.cardUnit}>% saturation</div>
          </div>

          <div style={S.card(latest.moisture2 > 70)}>
            <div style={S.cardIcon}>💧</div>
            <div style={S.cardLabel}>SOIL MOISTURE 2</div>
            <div style={S.cardVal(latest.moisture2 > 70 ? "#E74C3C" : latest.moisture2 > 45 ? "#E67E22" : "#27AE60")}>{latest.moisture2.toFixed(1)}</div>
            <div style={S.cardUnit}>% saturation</div>
          </div>

          <div style={S.card(latest.accelMag > 0.3)}>
            <div style={S.cardIcon}>📐</div>
            <div style={S.cardLabel}>VIBRATION</div>
            <div style={S.cardVal(latest.accelMag > 0.3 ? "#E74C3C" : "#E8EDF3")}>{latest.accelMag.toFixed(3)}</div>
            <div style={S.cardUnit}>m/s² / ADXL345</div>
          </div>

          <div style={S.card(false)}>
            <div style={S.cardIcon}>↔️</div>
            <div style={S.cardLabel}>TILT / ACCEL</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#C5D2DF", marginTop: 4, lineHeight: 1.8 }}>
              X: {latest.accelX.toFixed(3)}<br/>
              Y: {latest.accelY.toFixed(3)}<br/>
              Z: {latest.accelZ.toFixed(3)}
            </div>
            <div style={S.cardUnit}>m/s²</div>
          </div>

          <div style={S.card(latest.rain === 1)}>
            <div style={S.cardIcon}>🌧</div>
            <div style={S.cardLabel}>RAIN SENSOR</div>
            <div style={S.cardVal(latest.rain ? "#4A9ECC" : "#27AE60")}>{latest.rain ? "WET" : "DRY"}</div>
            <div style={S.cardUnit}>surface state</div>
          </div>

          <div style={S.card(latest.humidity > 80)}>
            <div style={S.cardIcon}>💨</div>
            <div style={S.cardLabel}>HUMIDITY</div>
            <div style={S.cardVal(latest.humidity > 80 ? "#E67E22" : "#E8EDF3")}>{latest.humidity.toFixed(1)}</div>
            <div style={S.cardUnit}>% RH (DHT22)</div>
          </div>

          <div style={S.card(false)}>
            <div style={S.cardIcon}>🌡</div>
            <div style={S.cardLabel}>TEMPERATURE</div>
            <div style={S.cardVal("#E8EDF3")}>{latest.temp.toFixed(1)}</div>
            <div style={S.cardUnit}>°C (DHT22)</div>
          </div>

          <div style={S.card(latest.pressure < 1000)}>
            <div style={S.cardIcon}>🔵</div>
            <div style={S.cardLabel}>PRESSURE</div>
            <div style={S.cardVal(latest.pressure < 1000 ? "#9B59B6" : "#E8EDF3")}>{latest.pressure.toFixed(1)}</div>
            <div style={S.cardUnit}>hPa (BMP180)</div>
          </div>

          <div style={{ ...S.card(false), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 100 60" width="100" style={{ marginBottom: 8 }}>
              <path d="M10,55 A45,45 0 0,1 90,55" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" strokeLinecap="round"/>
              <path d="M10,55 A45,45 0 0,1 90,55" fill="none" stroke={risk.color} strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${(latest.risk / 100) * 141.4} 141.4`} />
            </svg>
            <div style={{ fontSize: 22, fontWeight: 700, color: risk.color, lineHeight: 1 }}>{latest.risk}%</div>
            <div style={{ fontSize: 10, color: "#526070", marginTop: 3, letterSpacing: "0.06em", fontWeight: 600 }}>AI RISK SCORE</div>
          </div>
        </div>

        <div style={S.chartBox}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={S.chartTitle}>LIVE TREND — {chartConfig.label}</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["risk","Risk","#E74C3C"],["moisture","Moisture","#4A9ECC"],["accel","Accel","#F0A500"],["pressure","Pressure","#9B59B6"]].map(([key,lbl,col]) => (
                <button key={key} onClick={() => setTab(key)} style={{
                  fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                  background: tab === key ? `${col}22` : "transparent",
                  color: tab === key ? col : "#526070",
                  border: `1px solid ${tab === key ? `${col}55` : "rgba(255,255,255,0.06)"}`,
                }}>{lbl}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="ts" tick={{ fill: "#526070", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
              <YAxis tick={{ fill: "#526070", fontSize: 10 }} tickLine={false} axisLine={false}/>
              <Tooltip content={<CustomTip />}/>
              {tab === "risk" && <ReferenceLine y={34} stroke="rgba(230,126,34,0.3)" strokeDasharray="4 4"/>}
              {tab === "risk" && <ReferenceLine y={67} stroke="rgba(231,76,60,0.3)" strokeDasharray="4 4"/>}
              <Line type="monotone" dataKey={chartConfig.key} stroke={chartConfig.color} strokeWidth={2} dot={false} isAnimationActive={false}/>
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={S.logBox}>
          <div style={S.logHeader}>
            <div style={S.logTitle}>SENSOR LOG</div>
            <div style={S.logCount}>{readings.length} readings · last {MAX_LOG} shown</div>
          </div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                {["Time","Risk","Moisture 1","Moisture 2","Rain","Vibration","Humidity","Temp","Pressure"].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[...readings].reverse().slice(0,MAX_LOG).map((r,i)=>{
                  const rl=riskLabel(r.risk);
                  return <tr key={i}>
                    <td style={S.td(i%2)}>{r.ts}</td>
                    <td style={S.tdRisk(rl)}>{r.risk}% {rl.label}</td>
                    <td style={S.td(i%2)}>{r.moisture.toFixed(1)}%</td>
                    <td style={S.td(i%2)}>{r.moisture2.toFixed(1)}%</td>
                    <td style={{...S.td(i%2),color:r.rain?"#4A9ECC":"#526070",fontWeight:r.rain?700:400}}>{r.rain?"WET":"DRY"}</td>
                    <td style={S.td(i%2)}>{r.accelMag.toFixed(3)}</td>
                    <td style={S.td(i%2)}>{r.humidity.toFixed(1)}%</td>
                    <td style={S.td(i%2)}>{r.temp.toFixed(1)}°C</td>
                    <td style={S.td(i%2)}>{r.pressure.toFixed(1)} hPa</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{
          background:"rgba(240,165,0,0.05)",border:"1px solid rgba(240,165,0,0.15)",
          borderRadius:10,padding:"16px 20px",fontSize:13,color:"#8DA3BA",lineHeight:1.7
        }}>
          <strong style={{color:"#F0A500"}}>📡 PRAHARI — Wayanad monitoring</strong><br/>
          {connected
            ? <>Connected to <code>{API_BASE}</code>. The dashboard is reading the backend's latest ESP32 prediction.</>
            : <>Waiting for the PRAHARI backend at <code>{API_BASE}</code>. Start the backend and send an ESP32 reading to <code>/data</code>.</>}
        </div>
      </div>
    </div>
  );
}
