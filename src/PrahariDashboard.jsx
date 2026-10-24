        <div style={S.grid}>
          <div style={S.card(latest.moisture > 70)}>
            <div style={S.cardIcon}>💧</div>
            <div style={S.cardLabel}>SOIL MOISTURE 1</div>
            <div
              style={S.cardVal(
                latest.moisture > 70
                  ? "#E74C3C"
                  : latest.moisture > 45
                    ? "#E67E22"
                    : "#27AE60"
              )}
            >
              {latest.moisture.toFixed(1)}
            </div>
            <div style={S.cardUnit}>% saturation</div>
          </div>

          <div style={S.card(latest.moisture2 > 70)}>
            <div style={S.cardIcon}>💧</div>
            <div style={S.cardLabel}>SOIL MOISTURE 2</div>
            <div
              style={S.cardVal(
                latest.moisture2 > 70
                  ? "#E74C3C"
                  : latest.moisture2 > 45
                    ? "#E67E22"
                    : "#27AE60"
              )}
            >
              {latest.moisture2.toFixed(1)}
            </div>
            <div style={S.cardUnit}>% saturation</div>
          </div>

          <div style={S.card(false)}>
            <div style={S.cardIcon}>📐</div>
            <div style={S.cardLabel}>VIBRATION</div>
            <div style={S.cardVal("#E8EDF3")}>
              {Math.abs(latest.accelMag - 9.81).toFixed(1)}
            </div>
            <div style={S.cardUnit}>m/s² / ADXL345</div>
          </div>

          <div style={S.card(false)}>
            <div style={S.cardIcon}>↔️</div>
            <div style={S.cardLabel}>TILT / ACCEL</div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#C5D2DF",
                marginTop: 4,
                lineHeight: 1.8,
              }}
            >
              X: {latest.accelX.toFixed(3)}
              <br />
              Y: {latest.accelY.toFixed(3)}
              <br />
              Z: {latest.accelZ.toFixed(3)}
            </div>
            <div style={S.cardUnit}>m/s²</div>
          </div>

          <div style={S.card(latest.rain === 1)}>
            <div style={S.cardIcon}>🌧</div>
            <div style={S.cardLabel}>RAIN SENSOR</div>
            <div style={S.cardVal(latest.rain ? "#4A9ECC" : "#27AE60")}>
              {latest.rain ? "WET" : "DRY"}
            </div>
            <div style={S.cardUnit}>surface state</div>
          </div>

          <div style={S.card(latest.humidity > 80)}>
            <div style={S.cardIcon}>💨</div>
            <div style={S.cardLabel}>HUMIDITY</div>
            <div
              style={S.cardVal(
                latest.humidity > 80 ? "#E67E22" : "#E8EDF3"
              )}
            >
              {latest.humidity.toFixed(1)}
            </div>
            <div style={S.cardUnit}>% RH (DHT22)</div>
          </div>

          <div style={S.card(false)}>
            <div style={S.cardIcon}>🌡</div>
            <div style={S.cardLabel}>TEMPERATURE</div>
            <div style={S.cardVal("#E8EDF3")}>
              {latest.temp.toFixed(1)}
            </div>
            <div style={S.cardUnit}>°C (DHT22)</div>
          </div>

          <div style={S.card(false)}>
            <div style={S.cardIcon}>🔵</div>
            <div style={S.cardLabel}>PRESSURE</div>
            <div style={S.cardVal("#9B59B6")}>
              {latest.pressure.toFixed(1)}
            </div>
            <div style={S.cardUnit}>hPa (BMP180)</div>
          </div>

          <div
            style={{
              ...S.card(false),
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg viewBox="0 0 100 60" width="100" style={{ marginBottom: 8 }}>
              <path
                d="M10,55 A45,45 0 0,1 90,55"
                fill="none"
                stroke="rgba(255,255,255,0.07)"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M10,55 A45,45 0 0,1 90,55"
                fill="none"
                stroke={risk.color}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(latest.risk / 100) * 141.4} 141.4`}
              />
            </svg>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: risk.color,
                lineHeight: 1,
              }}
            >
              {latest.risk}%
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#8DA3BA",
                marginTop: 3,
                letterSpacing: "0.06em",
                fontWeight: 600,
              }}
            >
              AI RISK SCORE
            </div>
          </div>
        </div>

        <div style={S.chartBox}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div style={S.chartTitle}>
              LIVE TREND — {chartConfig.label}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                ["risk", "Risk", "#E74C3C"],
                ["moisture", "Moisture", "#4A9ECC"],
                ["accel", "Accel", "#F0A500"],
                ["pressure", "Pressure", "#9B59B6"],
              ].map(([key, lbl, col]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "4px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: tab === key ? `${col}22` : "transparent",
                    color: tab === key ? col : "#8DA3BA",
                    border: `1px solid ${
                      tab === key ? `${col}55` : "rgba(255,255,255,0.06)"
                    }`,
                  }}
