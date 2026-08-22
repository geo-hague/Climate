document.addEventListener('DOMContentLoaded', function() {
  let lastStation = null, fullDataset = null, allStations = [], currentRange = { start: 1991, end: 2020 };
  let dailyReferenceValues = { tmin: [], tmax: [] };
  let threshUserEdited = false;
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function showSpinner(msg) {
    const el = document.getElementById('pageSpinner');
    el.querySelector('.page-spinner-msg').textContent = msg || 'Loading…';
    el.style.display = 'flex';
  }
  function hideSpinner() {
    document.getElementById('pageSpinner').style.display = 'none';
  }

  // CHART FULLSCREEN TOGGLE — each chart frame can expand to fill the screen and back.
  // Uses the native Fullscreen API where supported; falls back to a fixed-position, full-viewport
  // overlay for browsers that don't support element fullscreen (notably iPhone Safari, which only
  // supports fullscreen on <video>).
  const ALL_CHART_IDS = ['boxDiv', 'lineDiv', 'windowTempDiv', 'windowPrecipDiv', 'climatoDiv', 'dailyClimatoDiv'];
  let fallbackFrame = null;

  function supportsNativeFs(el) {
      return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen);
  }
  function requestFs(el) {
      const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (fn) fn.call(el);
  }
  function exitFs() {
      const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (fn) fn.call(document);
  }
  function currentFsElement() {
      return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
  }

  function resizeAllCharts() {
      setTimeout(() => {
          ALL_CHART_IDS.forEach(id => {
              if (document.getElementById(id) && window.Plotly) {
                  try { Plotly.Plots.resize(id); } catch (err) { /* chart not yet drawn */ }
              }
          });
      }, 60);
  }

  function updateFsButtonIcons() {
      const active = currentFsElement() || fallbackFrame;
      document.querySelectorAll('.chart-frame').forEach(frame => {
          const btn = frame.querySelector('.chart-fs-btn');
          if (!btn) return;
          const isActive = frame === active;
          btn.innerHTML = isActive ? '✕' : '⤢';
          btn.title = isActive ? 'Exit Full Screen' : 'Full Screen';
      });
  }

  function toggleChartFrame(frame) {
      if (supportsNativeFs(frame)) {
          if (currentFsElement() === frame) exitFs();
          else requestFs(frame);
          return; // icon update + resize handled by the fullscreenchange listener below
      }
      // Fallback path (e.g. iPhone Safari)
      if (fallbackFrame === frame) {
          frame.classList.remove('fs-fallback');
          document.body.classList.remove('fs-fallback-active');
          fallbackFrame = null;
      } else {
          if (fallbackFrame) fallbackFrame.classList.remove('fs-fallback');
          frame.classList.add('fs-fallback');
          document.body.classList.add('fs-fallback-active');
          fallbackFrame = frame;
      }
      updateFsButtonIcons();
      resizeAllCharts();
  }

  document.querySelectorAll('.chart-fs-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const frame = document.getElementById(btn.dataset.frame);
          if (!frame) return;
          toggleChartFrame(frame);
      });
  });

  // Escape key closes the CSS-fallback overlay (native fullscreen already closes on Escape by itself)
  document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && fallbackFrame) toggleChartFrame(fallbackFrame);
  });

  ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(evt => {
      document.addEventListener(evt, () => {
          updateFsButtonIcons();
          // Plotly draws to fixed pixel dimensions, so every chart needs a resize once the
          // fullscreen container has settled into its new size (whether entering or exiting).
          resizeAllCharts();
      });
  });

  function dayOfYear(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Math.round((new Date(y, m-1, d) - new Date(y, 0, 1)) / 86400000) + 1;
  }
  function doyToDateStr(doy) {
    return new Date(2023, 0, doy).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }
  function medianFrostDate(thresholdF, season, rangeS, rangeE) {
    if (!fullDataset) return null;
    const threshold = Math.round((thresholdF - 32) * 5 / 9 * 10);
    const years = [...new Set(fullDataset.map(d => parseInt(d.DATE.split('-')[0])))]
        .filter(y => y >= rangeS && y <= rangeE)
        .sort();
    const qualifying = [];
    let yearsWithData = 0;
    years.forEach(y => {
      const rows = fullDataset.filter(d => parseInt(d.DATE.split('-')[0]) === y && d.TMIN != null);
      if (rows.length < 200) return;
      yearsWithData++;
      const hits = rows.filter(d => d.TMIN <= threshold);
      if (season === 'spring') {
        const springHits = hits.filter(d => parseInt(d.DATE.split('-')[1]) <= 6);
        if (springHits.length) qualifying.push(Math.max(...springHits.map(d => dayOfYear(d.DATE))));
      } else {
        const fallHits = hits.filter(d => parseInt(d.DATE.split('-')[1]) >= 7);
        if (fallHits.length) qualifying.push(Math.min(...fallHits.map(d => dayOfYear(d.DATE))));
      }
    });
    if (qualifying.length === 0) return yearsWithData >= 10 ? 'none' : null;
    if (qualifying.length < 5) return null;
    const sorted = [...qualifying].sort((a, b) => a - b);
    return doyToDateStr(sorted[Math.floor(sorted.length / 2)]);
  }

  const map = L.map('map', { zoomSnap: 0.5 }).setView([35.5, -80], 7);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }).addTo(map);
  const markers = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40 });

  const legend = L.control({ position: 'bottomright' });
  
  legend.onAdd = function (map) {
      const div = L.DomUtil.create('div', 'legend');
      
      // Using a template string to keep it clean
      div.innerHTML = `
          <strong style="display:block; margin-bottom:5px; font-size:0.75rem;">Station Type</strong>
          <div><i style="background: #10ac84;"></i>COOP (USC)</div>
          <div><i style="background: #f39c12;"></i>RAWS (USR)</div>
          <div><i style="background: #2e86de;"></i>ASOS/AWOS (USW)</div>
      `;
      return div;
  };

legend.addTo(map);

  // Define a custom Leaflet Control
  const LocateControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function(map) {
          // Create the main container with Leaflet's 'leaflet-bar' class
          const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate');

          // Create a link element to match the structure of Zoom buttons
          const link = L.DomUtil.create('a', '', container);
          link.href = '#';
          link.title = "Find nearest station";
          link.role = "button";
          link.ariaLabel = "Find nearest station";

          link.innerHTML = `
              <svg viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
              </svg>`;

          // Move the click event to the link
          link.onclick = function(e) {
              e.preventDefault();
              e.stopPropagation();

              if (!navigator.geolocation) {
                  alert("Geolocation is not supported");
                  return;
              }

              // Your existing geolocation logic here...
              navigator.geolocation.getCurrentPosition((position) => {
                  const userLat = position.coords.latitude;
                  const userLon = position.coords.longitude;
                  if (allStations.length === 0) return;
                  let closest = null;
                  let minDist = Infinity;
                  allStations.forEach(st => {
                      if (!st.lat || !st.lon) return;
                      const d = Math.sqrt(Math.pow(userLat - st.lat, 2) + Math.pow(userLon - st.lon, 2));
                      if (d < minDist) {
                          minDist = d;
                          closest = st;
                      }
                  });
                  if (closest) {
                      map.flyTo([userLat, userLon], 10);
                      setTimeout(() => selectStation(closest), 1000);
                  }
              }, () => alert("Location access denied"));
          };

          return container;
      }
  });

  map.addControl(new LocateControl());

  function getStationStyles(id) {
    if (id.startsWith('USC')) return { fill: 'rgba(16, 172, 132, 0.3)', stroke: '#10ac84' };
    if (id.startsWith('USR')) return { fill: 'rgba(243, 156, 18, 0.3)', stroke: '#f39c12' };
    if (id.startsWith('USW')) return { fill: 'rgba(46, 134, 222, 0.3)', stroke: '#2e86de' };
    return { fill: 'rgba(149, 165, 166, 0.3)', stroke: '#95a5a6' };
  }

  Papa.parse('data/stations.csv', {
    download: true, header: true, skipEmptyLines: true,
    complete: function(results) {
      allStations = results.data;
      allStations.forEach(st => {
        if(!st.lat || !st.lon) return;
        const styles = getStationStyles(st.station);
        const dot = L.circleMarker([parseFloat(st.lat), parseFloat(st.lon)], {
          radius: 6, fillColor: styles.fill, color: styles.stroke, weight: 2, opacity: 1, fillOpacity: 1
        });
        dot.bindTooltip(`${st.name}, ${st.state || ''}`);
        dot.on('click', () => selectStation(st));
        markers.addLayer(dot);
      });
      map.addLayer(markers);
    }
  });

  const searchInput = document.getElementById('stationSearch');
  searchInput.value = '';
  const searchResults = document.getElementById('searchResults');
  const clearBtn = document.getElementById('clearSearch');

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase();
    clearBtn.style.display = val.length > 0 ? 'block' : 'none';
    searchResults.innerHTML = '';
    if (val.length < 2) { searchResults.style.display = 'none'; return; }
    const filtered = allStations.filter(s => s.name.toLowerCase().includes(val) || s.station.toLowerCase().includes(val)).slice(0, 15);
    if (filtered.length > 0) {
        filtered.forEach(s => {
                const div = document.createElement('div');
                div.className = 'search-item';

                // This line adds the name, the ID below it, and the State Badge on the right
                div.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <div>
                            <strong>${s.name}</strong><br>
                            <small style="color:var(--sub-text)">${s.station}</small>
                        </div>
                        <span class="state-badge">${s.state || ''}</span>
                    </div>
                `;
                  
                div.onclick = () => { 
                    selectStation(s); 
                    searchResults.style.display = 'none'; 
                    searchInput.value = ''; 
                    clearBtn.style.display = 'none'; 
                };
                searchResults.appendChild(div);
            });
        searchResults.style.display = 'block';
    } else { searchResults.style.display = 'none'; }
  });

  clearBtn.onclick = () => { searchInput.value = ''; clearBtn.style.display = 'none'; searchResults.style.display = 'none'; searchInput.focus(); };

  document.addEventListener('click', (e) => {
    // We check if the click was anywhere OTHER than the input or the results box
    const isClickInsideSearch = searchInput.contains(e.target) || searchResults.contains(e.target);

    if (!isClickInsideSearch) {
        searchResults.style.display = 'none';
    }
  });

  function selectStation(st) {
    lastStation = st;
    map.setView([st.lat, st.lon], 11);
    triggerDataFetch();
  }

  function triggerDataFetch() {
      if (!lastStation) return;
      const statePath = (lastStation.state || 'UNK').toUpperCase();
      const filePath = `data/daily/${statePath}/${lastStation.station}.csv`;
      showSpinner('Loading station data...');

      Papa.parse(filePath, {
        download: true, 
        header: true, 
        dynamicTyping: true, 
        skipEmptyLines: true,
        complete: function(results) {
          fullDataset = results.data;

          // Filter out any rows without a valid date to calculate year range
          const validRows = fullDataset.filter(d => d.DATE);
          const years = validRows.map(d => parseInt(d.DATE.split('-')[0]));

          const minYear = Math.min(...years);
          const maxYear = Math.max(...years);

          // Update the header with the Name, Station ID Badge, and Date Range
          document.getElementById('stationHeader').innerHTML = `
              <span>Station:</span>
              <span style="color:var(--text)">${lastStation.name}, ${lastStation.state}</span>
              <span class="station-id-badge">${lastStation.station}</span>
              <span style="font-size:0.85rem; color:var(--sub-text); font-weight:400;">
                  (${minYear}–${maxYear})
              </span>
          `;
            
          processAndPlot();
          document.getElementById('cardTabs').style.display = 'flex';
          document.getElementById('climatoWrap').style.display = 'block';
          hideSpinner();
        },
        error: function() {
          hideSpinner();
        }
      });
    }

  function populateDays(selectedDay = null) {
    const month = parseInt(document.getElementById('month').value);
    const daySelect = document.getElementById('day');
    const daysInMonth = new Date(2024, month, 0).getDate();
    const prevVal = selectedDay || parseInt(daySelect.value) || 1;
    daySelect.innerHTML = '';
    for (let i = 1; i <= daysInMonth; i++) {
      const opt = document.createElement('option');
      opt.value = i; opt.innerHTML = i;
      if (i === prevVal || (i === daysInMonth && prevVal > daysInMonth)) opt.selected = true;
      daySelect.appendChild(opt);
    }
  }

// --- INITIALIZE YEAR DROPDOWN ---
const yearSelect = document.getElementById('yearSelect');
const currYear = 2026; 

for (let y = currYear; y >= 1850; y--) {
    let opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === currYear) opt.selected = true;
    yearSelect.appendChild(opt);
}

let isSyncing = false;

function syncPeriodToYear(year) {
    let start, end;

    // 1. Handle the outliers first
    if (year < 1961) {
        start = 0; end = 9999; // All Data
    } 
    else if (year > 2020) {
        start = 1991; end = 2020; // Default to most recent normal
    }
    // 2. Handle overlaps by prioritizing the most "current" bracket for that year
    else if (year >= 1991) {
        start = 1991; end = 2020;
    } else if (year >= 1981) {
        start = 1981; end = 2010;
    } else if (year >= 1971) {
        start = 1971; end = 2000;
    } else if (year >= 1961) {
        start = 1961; end = 1990;
    }

    // Now find the button and click it
    const buttons = document.querySelectorAll('.period-btn');
    buttons.forEach(btn => {
        if (parseInt(btn.dataset.start) === start && parseInt(btn.dataset.end) === end) {
            // Check if it's already active to prevent "click loops"
            if (!btn.classList.contains('active')) {
                btn.click();
            }
        }
    });
}

document.getElementById('yearSelect').addEventListener('change', (e) => {
    if (isSyncing) return;
    isSyncing = true;
    
    const selectedYear = parseInt(e.target.value);
    syncPeriodToYear(selectedYear);
    
    // ADD THIS LINE:
    processAndPlot(); 
    
    isSyncing = false;
});

  function updateToggleColors() {
    const isF = document.getElementById('unitToggle').checked;
    const labelC = document.getElementById('labelC');
    const labelF = document.getElementById('labelF');
    if (isF) { labelF.classList.add('unit-active'); labelC.classList.remove('unit-active'); }
    else { labelC.classList.add('unit-active'); labelF.classList.remove('unit-active'); }
  }

  const now = new Date();
  document.getElementById('month').value = now.getMonth() + 1;
  populateDays(now.getDate());
  document.getElementById('defaultPeriod').classList.add('active');
  updateToggleColors();

  // Change triggerDataFetch to processAndPlot so we use the data already in memory
  document.getElementById('month').addEventListener('change', () => { 
      populateDays(); 
      processAndPlot(); 
  });

  document.getElementById('day').addEventListener('change', processAndPlot);

  document.getElementById('unitToggle').addEventListener('change', () => { 
      updateToggleColors(); 
      const isF = document.getElementById('unitToggle').checked;
      const threshInput = document.getElementById('threshTemp');
      const cur = parseFloat(threshInput.value);
      if (!threshUserEdited) {
          threshInput.value = isF ? 50 : 10;
      } else if (!isNaN(cur)) {
          threshInput.value = Math.round(isF ? (cur * 9/5 + 32) : ((cur - 32) * 5/9));
      }
      processAndPlot(); 
  });

  document.getElementById('threshTemp').addEventListener('input', () => {
      threshUserEdited = true;
      updateThresholdCard();
  });
  document.getElementById('threshCompare').addEventListener('change', updateThresholdCard);
  document.getElementById('threshField').addEventListener('change', updateThresholdCard);

  document.getElementById('todayBtn').addEventListener('click', () => {
      const today = new Date();
      const currentYear = 2026; 

      document.getElementById('month').value = today.getMonth() + 1;
      populateDays(today.getDate()); // Update the day dropdown options
      document.getElementById('day').value = today.getDate();
      document.getElementById('yearSelect').value = currentYear;

      syncPeriodToYear(currentYear);
      processAndPlot(); // Refresh everything
  });

  document.querySelectorAll('.card-tab').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.card-tab').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
      document.getElementById(this.dataset.tab).style.display = 'block';
    });
  });

  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      currentRange.start = parseInt(this.dataset.start);
      currentRange.end = parseInt(this.dataset.end);
      showSpinner("Recalculating normals...");
      setTimeout(() => {
        processAndPlot();
      }, 16);
    });
  });

  async function fetchLiveComparison(lat, lon, normalHighVal, normalLowVal) {
      const liveRow = document.getElementById('liveRow');
      const isF = document.getElementById('unitToggle').checked;
      const unit = isF ? "°F" : "°C";

      try {
          const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`);
          const pointData = await pointRes.json();
          const hourlyUrl = pointData.properties.forecastHourly;
          
          const stationListRes = await fetch(pointData.properties.observationStations);
          const stationListData = await stationListRes.json();
          const stationFeature = stationListData.features[0];
          const stationId = stationFeature.properties.stationIdentifier;
          const stationName = stationFeature.properties.name;

          const [hourlyRes, obsRes] = await Promise.all([
              fetch(hourlyUrl),
              fetch(`https://api.weather.gov/stations/${stationId}/observations`)
          ]);

          const hourlyData = await hourlyRes.json();
          const obsData = await obsRes.json();
          const todayStr = new Date().toDateString();

          const todayObsF = obsData.features
              .filter(obs => new Date(obs.properties.timestamp).toDateString() === todayStr)
              .map(obs => obs.properties.temperature.value)
              .filter(v => v !== null)
              .map(v => (v * 9/5 + 32));

          const actualLowF = todayObsF.length ? Math.min(...todayObsF) : null;
          const actualHighF = todayObsF.length ? Math.max(...todayObsF) : null;

          const currentTime = new Date();
          const forecastRemainingF = hourlyData.properties.periods
              .filter(p => new Date(p.startTime).toDateString() === todayStr)
              .filter(p => new Date(p.startTime) >= currentTime)
              .map(p => p.temperature);

          const forecastLowF = forecastRemainingF.length ? Math.min(...forecastRemainingF) : null;
          const forecastHighF = forecastRemainingF.length ? Math.max(...forecastRemainingF) : null;

          let finalLowF = actualLowF;
          if (forecastLowF !== null) finalLowF = (finalLowF === null) ? forecastLowF : Math.min(finalLowF, forecastLowF);

          let finalHighF = actualHighF;
          if (forecastHighF !== null) finalHighF = (finalHighF === null) ? forecastHighF : Math.max(finalHighF, forecastHighF);

          const dispHigh = isF ? finalHighF : (finalHighF - 32) * 5/9;
          const dispLow = isF ? finalLowF : (finalLowF - 32) * 5/9;

          liveRow.style.display = 'flex';
          document.getElementById('liveMin').textContent = dispLow.toFixed(1) + unit;
          document.getElementById('liveMax').textContent = dispHigh.toFixed(1) + unit;

          const sourceTag = `<br><span style="font-size:0.6rem; color:var(--sub-text); font-weight:400; text-transform:none;">Source: ${stationName}</span>`;
          
          const isMinObserved = actualLowF !== null && (forecastLowF === null || actualLowF <= forecastLowF);
          const isMaxObserved = actualHighF !== null && (forecastHighF === null || actualHighF >= forecastHighF);

          document.getElementById('liveMinLabel').innerHTML = (isMinObserved ? "Observed Minimum Temperature" : "Projected Minimum Temperature") + sourceTag;
          document.getElementById('liveMaxLabel').innerHTML = (isMaxObserved ? "Observed Maximum Temperature" : "Projected Maximum Temperature") + sourceTag;

          updateDepartureBadge('liveMinDep', dispLow, normalLowVal, dailyReferenceValues.tmin);
          updateDepartureBadge('liveMaxDep', dispHigh, normalHighVal, dailyReferenceValues.tmax);

      } catch (e) {
          console.error("Live fetch failed", e);
          liveRow.style.display = 'none';
      }
  }

  function updateDepartureBadge(id, current, normal, referenceValues, label = 'daily average') {
      const el = document.getElementById(id);
      if (normal === "--" || !referenceValues || referenceValues.length === 0) { el.textContent = ""; return; }
      
      const cleanNormal = parseFloat(normal.toString().replace(/[^\d.-]/g, ''));
      const diffNum = parseFloat(current) - cleanNormal;
      const diffStr = diffNum.toFixed(1);
      
      if (isNaN(diffNum)) { el.textContent = ""; return; }

      const avg = referenceValues.reduce((a, b) => a + b, 0) / referenceValues.length;
      const stdDev = Math.sqrt(referenceValues.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / referenceValues.length);
      const sigma = stdDev > 0 ? Math.abs(diffNum) / stdDev : 0;

      let classification = "Normal";
      if (sigma > 2) classification = (diffNum > 0 ? "Well Above" : "Well Below") + " Normal";
      else if (sigma > 1) classification = (diffNum > 0 ? "Above" : "Below") + " Normal";

      const fullText = `${diffNum > 0 ? '+' : ''}${diffStr}° from ${label} (${classification})`;

      if (diffNum > 0.05) {
          el.style.color = "var(--max-color)";
          el.textContent = fullText;
      } else if (diffNum < -0.05) {
          el.style.color = "var(--min-color)";
          el.textContent = fullText;
      } else {
          el.style.color = "var(--sub-text)";
          el.textContent = `Exactly at ${label} (Normal)`;
      }
  }

  function getSigmaClassification(current, normal, referenceValues) {
    if (normal === "--" || !referenceValues || referenceValues.length === 0) return "";
    
    const cleanNormal = parseFloat(normal.toString().replace(/[^\d.-]/g, ''));
    const diffNum = parseFloat(current) - cleanNormal;
    if (isNaN(diffNum)) return "";

    const avg = referenceValues.reduce((a, b) => a + b, 0) / referenceValues.length;
    const stdDev = Math.sqrt(referenceValues.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / referenceValues.length);
    const sigma = stdDev > 0 ? Math.abs(diffNum) / stdDev : 0;

    if (Math.abs(diffNum) <= 0.05) return "Normal"; // Match your "Exactly at" logic
    if (sigma > 2) return (diffNum > 0 ? "Well Above" : "Well Below") + " Normal";
    if (sigma > 1) return (diffNum > 0 ? "Above" : "Below") + " Normal";
    return "Normal";
}

  function processAndPlot() {
    if (!fullDataset) return;

    // 1. SET UP VARIABLES
    const mIdx = parseInt(document.getElementById('month').value);
    const dReq = parseInt(document.getElementById('day').value);
    const sYear = parseInt(document.getElementById('yearSelect').value);
    const isF = document.getElementById('unitToggle').checked;
    const unit = isF ? "°F" : "°C";
    const convert = (v) => (v == null ? null : (isF ? (v * 9/5 + 32) : v));
    const monthName = monthNames[mIdx - 1];
    const systemYear = 2026; 
    const todayDate = new Date();
    const currentSystemMonth = todayDate.getMonth() + 1;
    const isCurrentPartialMonth = (sYear === systemYear && mIdx === currentSystemMonth);

    const fmtDate = (dateStr) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        return `${monthNames[m-1]} ${d}, ${y}`;
    };

    // Finds the latest DATE (YYYY-MM-DD strings sort correctly) among rows that have `field`
    // populated; falls back to the latest date of any row if none have that field.
    const latestDateInScope = (rows, field) => {
        const withField = rows.filter(d => d[field] != null);
        const use = withField.length ? withField : rows.filter(d => d.DATE);
        if (!use.length) return null;
        return use.reduce((latest, d) => (!latest || d.DATE > latest) ? d.DATE : latest, null);
    };

    const getStdDev = (values) => {
        if (!values || values.length === 0) return 0;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        return Math.sqrt(values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length);
    };

    // 2. UPDATE LABELS & RANGE TEXT
    let startYear = parseInt(currentRange.start);
    let endYear = parseInt(currentRange.end);

    if (startYear === 0 || endYear >= 9999) {
        const yearList = fullDataset.map(d => parseInt(d.DATE.split('-')[0])).filter(y => !isNaN(y));
        startYear = Math.min(...yearList);
        endYear = Math.max(...yearList);
    }

    const rangeText = `${startYear}–${endYear}`;
    const rangeHtml = `<br><span style="font-size:0.65rem; color:var(--sub-text); font-weight:400; text-transform:none;">${rangeText}</span>`;

    document.getElementById('dayMinLabel').innerHTML = `${monthName} ${dReq} Average Minimum Temperature ${rangeHtml}`;
    document.getElementById('dayMaxLabel').innerHTML = `${monthName} ${dReq} Average Maximum Temperature ${rangeHtml}`;
    document.getElementById('monMinLabel').innerHTML = `${monthName} Average Minimum Temperature ${rangeHtml}`;
    document.getElementById('monMaxLabel').innerHTML = `${monthName} Average Maximum Temperature ${rangeHtml}`;
    document.getElementById('coldestMinDayLabel').innerHTML = `Day of Average Coldest Minimum Temperature ${rangeHtml}`;
    document.getElementById('coldestMaxDayLabel').innerHTML = `Day of Average Coldest Maximum Temperature ${rangeHtml}`;
    document.getElementById('warmestMinDayLabel').innerHTML = `Day of Average Warmest Minimum Temperature ${rangeHtml}`;
    document.getElementById('warmestMaxDayLabel').innerHTML = `Day of Average Warmest Maximum Temperature ${rangeHtml}`;
    document.getElementById('driestMonthLabel').innerHTML = `Driest Month (Average) ${rangeHtml}`;
    document.getElementById('wettestMonthLabel').innerHTML = `Wettest Month (Average) ${rangeHtml}`;


    // 3. PROCESS DATA FOR CARDS AND BOX PLOTS
    const rawMonthData = fullDataset.filter(d => d.DATE && parseInt(d.DATE.split('-')[1]) === mIdx)
      .map(r => ({
        year: parseInt(r.DATE.split('-')[0]),
        day: parseInt(r.DATE.split('-')[2]),
        tmax: (r.TMAX != null) ? r.TMAX/10 : null,
        tmin: (r.TMIN != null) ? r.TMIN/10 : null
      }));

    const periodData = rawMonthData.filter(d => d.year >= currentRange.start && d.year <= currentRange.end);
    const dailyRows = periodData.filter(d => d.day === dReq);
    const getAvg = (arr) => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : "--";
    
    dailyReferenceValues.tmin = dailyRows.map(r => convert(r.tmin)).filter(v => v !== null);
    dailyReferenceValues.tmax = dailyRows.map(r => convert(r.tmax)).filter(v => v !== null);

    const finalAvgMax = getAvg(dailyReferenceValues.tmax);
    const finalAvgMin = getAvg(dailyReferenceValues.tmin);

    document.getElementById('avgMax').textContent = finalAvgMax + unit;
    document.getElementById('avgMin').textContent = finalAvgMin + unit;
    document.getElementById('monMax').textContent = getAvg(periodData.map(r => convert(r.tmax)).filter(v => v !== null)) + unit;
    document.getElementById('monMin').textContent = getAvg(periodData.map(r => convert(r.tmin)).filter(v => v !== null)) + unit;

    // CLIMATOLOGICAL COLDEST/WARMEST DAY OF YEAR — average tmin/tmax per calendar day (MM-DD),
    // across all years in the selected normals period, over the whole year (not just the selected month)
    const dailyClimo = {};
    fullDataset.forEach(d => {
        if (!d.DATE) return;
        const p = d.DATE.split('-');
        const y = parseInt(p[0]);
        if (y < startYear || y > endYear) return;
        const md = `${p[1]}-${p[2]}`;
        if (!dailyClimo[md]) dailyClimo[md] = { tmaxSum: 0, tmaxN: 0, tminSum: 0, tminN: 0 };
        if (d.TMAX != null) { dailyClimo[md].tmaxSum += d.TMAX / 10; dailyClimo[md].tmaxN++; }
        if (d.TMIN != null) { dailyClimo[md].tminSum += d.TMIN / 10; dailyClimo[md].tminN++; }
    });

    let coldestMinDay = null, coldestMaxDay = null, warmestMinDay = null, warmestMaxDay = null;
    Object.keys(dailyClimo).forEach(md => {
        const rec = dailyClimo[md];
        if (rec.tminN > 0) {
            const avg = rec.tminSum / rec.tminN;
            if (!coldestMinDay || avg < coldestMinDay.avg) coldestMinDay = { md, avg };
            if (!warmestMinDay || avg > warmestMinDay.avg) warmestMinDay = { md, avg };
        }
        if (rec.tmaxN > 0) {
            const avg = rec.tmaxSum / rec.tmaxN;
            if (!coldestMaxDay || avg < coldestMaxDay.avg) coldestMaxDay = { md, avg };
            if (!warmestMaxDay || avg > warmestMaxDay.avg) warmestMaxDay = { md, avg };
        }
    });

    const fmtMonthDay = (md) => {
        const [mm, dd] = md.split('-').map(Number);
        return `${monthNames[mm - 1]} ${dd}`;
    };
    const fmtClimoDay = (rec) => rec ? `${fmtMonthDay(rec.md)} (${convert(rec.avg).toFixed(1)}${unit})` : '--';

    document.getElementById('coldestMinDay').textContent = fmtClimoDay(coldestMinDay);
    document.getElementById('coldestMaxDay').textContent = fmtClimoDay(coldestMaxDay);
    document.getElementById('warmestMinDay').textContent = fmtClimoDay(warmestMinDay);
    document.getElementById('warmestMaxDay').textContent = fmtClimoDay(warmestMaxDay);

    // RECORD HIGH/LOW — uses ALL data (rawMonthData has no year filter)
    const allDayRows = rawMonthData.filter(d => d.day === dReq);

    const recDayMaxRow = allDayRows.reduce((rec, r) => r.tmax !== null && (rec === null || r.tmax > rec.tmax) ? r : rec, null);
    const recDayMinRow = allDayRows.reduce((rec, r) => r.tmin !== null && (rec === null || r.tmin < rec.tmin) ? r : rec, null);
    const recMonMaxRow = rawMonthData.reduce((rec, r) => r.tmax !== null && (rec === null || r.tmax > rec.tmax) ? r : rec, null);
    const recMonMinRow = rawMonthData.reduce((rec, r) => r.tmin !== null && (rec === null || r.tmin < rec.tmin) ? r : rec, null);

    const yearSmall = (text) => `<br><span style="font-size:0.65rem; color:var(--sub-text); font-weight:400; text-transform:none;">${text}</span>`;

    document.getElementById('recDayMinLabel').innerHTML = `${monthName} ${dReq} Record Minimum Temperature${recDayMinRow ? yearSmall(`Set in ${recDayMinRow.year}`) : ''}`;
    document.getElementById('recDayMaxLabel').innerHTML = `${monthName} ${dReq} Record Maximum Temperature${recDayMaxRow ? yearSmall(`Set in ${recDayMaxRow.year}`) : ''}`;
    document.getElementById('recDayMin').textContent = recDayMinRow ? convert(recDayMinRow.tmin).toFixed(1) + unit : "--";
    document.getElementById('recDayMax').textContent = recDayMaxRow ? convert(recDayMaxRow.tmax).toFixed(1) + unit : "--";

    document.getElementById('recMonMinLabel').innerHTML = `${monthName} Record Minimum Temperature${recMonMinRow ? yearSmall(`Set in ${recMonMinRow.year} (${monthName} ${recMonMinRow.day})`) : ''}`;
    document.getElementById('recMonMaxLabel').innerHTML = `${monthName} Record Maximum Temperature${recMonMaxRow ? yearSmall(`Set in ${recMonMaxRow.year} (${monthName} ${recMonMaxRow.day})`) : ''}`;
    document.getElementById('recMonMin').textContent = recMonMinRow ? convert(recMonMinRow.tmin).toFixed(1) + unit : "--";
    document.getElementById('recMonMax').textContent = recMonMaxRow ? convert(recMonMaxRow.tmax).toFixed(1) + unit : "--";

    // RECORD WARMEST LOW / COOLEST HIGH — all data, no period filter
    const recDayMaxMinRow = allDayRows.reduce((rec, r) => r.tmin !== null && (rec === null || r.tmin > rec.tmin) ? r : rec, null);
    const recDayMinMaxRow = allDayRows.reduce((rec, r) => r.tmax !== null && (rec === null || r.tmax < rec.tmax) ? r : rec, null);
    const recMonMaxMinRow = rawMonthData.reduce((rec, r) => r.tmin !== null && (rec === null || r.tmin > rec.tmin) ? r : rec, null);
    const recMonMinMaxRow = rawMonthData.reduce((rec, r) => r.tmax !== null && (rec === null || r.tmax < rec.tmax) ? r : rec, null);

    document.getElementById('recDayMaxMinLabel').innerHTML = `${monthName} ${dReq} Record Warmest Low Temperature${recDayMaxMinRow ? yearSmall(`Set in ${recDayMaxMinRow.year}`) : ''}`;
    document.getElementById('recDayMaxMin').textContent = recDayMaxMinRow ? convert(recDayMaxMinRow.tmin).toFixed(1) + unit : "--";

    document.getElementById('recDayMinMaxLabel').innerHTML = `${monthName} ${dReq} Record Coolest High Temperature${recDayMinMaxRow ? yearSmall(`Set in ${recDayMinMaxRow.year}`) : ''}`;
    document.getElementById('recDayMinMax').textContent = recDayMinMaxRow ? convert(recDayMinMaxRow.tmax).toFixed(1) + unit : "--";

    document.getElementById('recMonMaxMinLabel').innerHTML = `${monthName} Record Warmest Low Temperature${recMonMaxMinRow ? yearSmall(`Set in ${recMonMaxMinRow.year} (${monthName} ${recMonMaxMinRow.day})`) : ''}`;
    document.getElementById('recMonMaxMin').textContent = recMonMaxMinRow ? convert(recMonMaxMinRow.tmin).toFixed(1) + unit : "--";

    document.getElementById('recMonMinMaxLabel').innerHTML = `${monthName} Record Coolest High Temperature${recMonMinMaxRow ? yearSmall(`Set in ${recMonMinMaxRow.year} (${monthName} ${recMonMinMaxRow.day})`) : ''}`;
    document.getElementById('recMonMinMax').textContent = recMonMinMaxRow ? convert(recMonMinMaxRow.tmax).toFixed(1) + unit : "--";

    // PRECIPITATION TOTALS
    const precipUnit = isF ? "in" : "mm";
    const precipDecimals = isF ? 2 : 1;
    const convertPrecip = (v) => {
        if (v == null) return 0;
        const mm = v / 10;
        return isF ? parseFloat((mm * 0.0393701).toFixed(precipDecimals)) : parseFloat(mm.toFixed(precipDecimals));
    };

    // Selected month/year totals
    const monthPrecipTotal = fullDataset
        .filter(d => { const p = d.DATE.split('-'); return parseInt(p[0]) === sYear && parseInt(p[1]) === mIdx; })
        .reduce((sum, d) => sum + convertPrecip(d.PRCP), 0);

    const yearPrecipTotal = fullDataset
        .filter(d => parseInt(d.DATE.split('-')[0]) === sYear)
        .reduce((sum, d) => sum + convertPrecip(d.PRCP), 0);

    const yearLabel = sYear === systemYear ? 'Year-to-Date' : 'Annual';

    // Per-year monthly totals for the selected month (all years in dataset)
    const allYears = [...new Set(fullDataset.map(d => parseInt(d.DATE.split('-')[0])))].sort();
    const monthlyTotalsByYear = allYears.map(y => ({
        year: y,
        total: fullDataset
            .filter(d => { const p = d.DATE.split('-'); return parseInt(p[0]) === y && parseInt(p[1]) === mIdx; })
            .reduce((sum, d) => sum + convertPrecip(d.PRCP), 0)
    }));

    // Per-year annual totals (all years in dataset)
    const annualTotalsByYear = allYears.map(y => ({
        year: y,
        total: fullDataset
            .filter(d => parseInt(d.DATE.split('-')[0]) === y)
            .reduce((sum, d) => sum + convertPrecip(d.PRCP), 0)
    }));

    // Average monthly precip (period range)
    const periodMonthlyTotals = monthlyTotalsByYear.filter(r => r.year >= currentRange.start && r.year <= currentRange.end);
    const avgMonthPrecip = periodMonthlyTotals.length
        ? periodMonthlyTotals.reduce((s, r) => s + r.total, 0) / periodMonthlyTotals.length
        : null;

    // Average annual precip (period range)
    const periodAnnualTotals = annualTotalsByYear.filter(r => r.year >= currentRange.start && r.year <= currentRange.end);
    const avgYearPrecip = periodAnnualTotals.length
        ? periodAnnualTotals.reduce((s, r) => s + r.total, 0) / periodAnnualTotals.length
        : null;

    // Average precipitation by calendar month (period range) — used to find the wettest/driest normal month
    const yearMonthPrecip = {};
    fullDataset.forEach(d => {
        if (!d.DATE) return;
        const p = d.DATE.split('-');
        const y = parseInt(p[0]), m = parseInt(p[1]);
        if (y < startYear || y > endYear) return;
        if (!yearMonthPrecip[y]) yearMonthPrecip[y] = Array(13).fill(0);
        yearMonthPrecip[y][m] += convertPrecip(d.PRCP);
    });
    const yearMonthRows = Object.values(yearMonthPrecip);
    let wettestMonth = null, driestMonth = null;
    for (let m = 1; m <= 12; m++) {
        if (yearMonthRows.length === 0) break;
        const avg = yearMonthRows.reduce((s, arr) => s + arr[m], 0) / yearMonthRows.length;
        if (!wettestMonth || avg > wettestMonth.avg) wettestMonth = { month: m, avg };
        if (!driestMonth || avg < driestMonth.avg) driestMonth = { month: m, avg };
    }

    // Record monthly precip (all years)
    const recMonthMaxPrecip = monthlyTotalsByYear.reduce((rec, r) => r.total > (rec?.total ?? -Infinity) ? r : rec, null);
    const recMonthMinPrecip = monthlyTotalsByYear.filter(r => r.year < systemYear).reduce((rec, r) => r.total < (rec?.total ?? Infinity) ? r : rec, null);

    // Record annual precip (all years)
    const recYearMaxPrecip = annualTotalsByYear.reduce((rec, r) => r.total > (rec?.total ?? -Infinity) ? r : rec, null);
    const recYearMinPrecip = annualTotalsByYear.filter(r => r.year < systemYear).reduce((rec, r) => r.total < (rec?.total ?? Infinity) ? r : rec, null);

    // All-time record temperatures (entire dataset, any date)
    const allTimeMaxRow = fullDataset.reduce((rec, r) => r.TMAX != null && (rec === null || r.TMAX > rec.TMAX) ? r : rec, null);
    const allTimeMinRow = fullDataset.reduce((rec, r) => r.TMIN != null && (rec === null || r.TMIN < rec.TMIN) ? r : rec, null);

    const fmtPrecip = (v) => v !== null ? v.toFixed(precipDecimals) + ' ' + precipUnit : '--';

    // "Latest Data" tags — shown when the selected month/year is the current, still-in-progress one
    let monthLatestTag = "";
    if (isCurrentPartialMonth) {
        const monthRowsSel = fullDataset.filter(d => { const p = d.DATE.split('-'); return parseInt(p[0]) === sYear && parseInt(p[1]) === mIdx; });
        const latestMonthDate = latestDateInScope(monthRowsSel, 'PRCP');
        if (latestMonthDate) monthLatestTag = yearSmall(`Latest Data: ${fmtDate(latestMonthDate)}`);
    }
    let yearLatestTag = "";
    if (sYear === systemYear) {
        const yearRowsSel = fullDataset.filter(d => parseInt(d.DATE.split('-')[0]) === sYear);
        const latestYearDate = latestDateInScope(yearRowsSel, 'PRCP');
        if (latestYearDate) yearLatestTag = yearSmall(`Latest Data: ${fmtDate(latestYearDate)}`);
    }

    // Update precip cards
    document.getElementById('precipMonthTotalLabel').innerHTML =
        `${monthName} ${sYear} Total Precipitation${monthLatestTag}`;
    document.getElementById('precipMonthTotal').textContent = fmtPrecip(monthPrecipTotal);

    document.getElementById('precipYearTotalLabel').innerHTML =
        `${sYear} ${yearLabel} Total Precipitation${yearLatestTag}`;
    document.getElementById('precipYearTotal').textContent = fmtPrecip(yearPrecipTotal);

    document.getElementById('precipAvgMonthLabel').innerHTML =
        `${monthName} Average Precipitation ${rangeHtml}`;
    document.getElementById('precipAvgMonth').textContent = fmtPrecip(avgMonthPrecip);

    document.getElementById('precipAvgYearLabel').innerHTML =
        `Average Annual Precipitation ${rangeHtml}`;
    document.getElementById('precipAvgYear').textContent = fmtPrecip(avgYearPrecip);

    const fmtMonthPrecip = (rec) => rec ? `${monthNames[rec.month - 1]} (${fmtPrecip(rec.avg)})` : '--';
    document.getElementById('wettestMonth').textContent = fmtMonthPrecip(wettestMonth);
    document.getElementById('driestMonth').textContent = fmtMonthPrecip(driestMonth);

    document.getElementById('precipRecMonthMaxLabel').innerHTML =
        `${monthName} Record Maximum Precipitation${recMonthMaxPrecip ? yearSmall(`Set in ${recMonthMaxPrecip.year}`) : ''}`;
    document.getElementById('precipRecMonthMax').textContent = fmtPrecip(recMonthMaxPrecip?.total ?? null);

    document.getElementById('precipRecMonthMinLabel').innerHTML =
        `${monthName} Record Minimum Precipitation${recMonthMinPrecip ? yearSmall(`Set in ${recMonthMinPrecip.year}`) : ''}`;
    document.getElementById('precipRecMonthMin').textContent = fmtPrecip(recMonthMinPrecip?.total ?? null);

    document.getElementById('precipRecYearMaxLabel').innerHTML =
        `Record Maximum Annual Precipitation${recYearMaxPrecip ? yearSmall(`Set in ${recYearMaxPrecip.year}`) : ''}`;
    document.getElementById('precipRecYearMax').textContent = fmtPrecip(recYearMaxPrecip?.total ?? null);

    document.getElementById('precipRecYearMinLabel').innerHTML =
        `Record Minimum Annual Precipitation${recYearMinPrecip ? yearSmall(`Set in ${recYearMinPrecip.year}`) : ''}`;
    document.getElementById('precipRecYearMin').textContent = fmtPrecip(recYearMinPrecip?.total ?? null);

    // All-time temperature records
    document.getElementById('allTimeMaxLabel').innerHTML =
        `All-Time Record Maximum Temperature${allTimeMaxRow ? yearSmall(fmtDate(allTimeMaxRow.DATE)) : ''}`;
    document.getElementById('allTimeMax').textContent = allTimeMaxRow ? convert(allTimeMaxRow.TMAX / 10).toFixed(1) + unit : '--';

    document.getElementById('allTimeMinLabel').innerHTML =
        `All-Time Record Minimum Temperature${allTimeMinRow ? yearSmall(fmtDate(allTimeMinRow.DATE)) : ''}`;
    document.getElementById('allTimeMin').textContent = allTimeMinRow ? convert(allTimeMinRow.TMIN / 10).toFixed(1) + unit : '--';

    // YTD PRECIPITATION
    // Cutoff: Jan 1 of selected year through selected month/day
    const mdCutoff = `${String(mIdx).padStart(2,'0')}-${String(dReq).padStart(2,'0')}`;
    const ytdCutoffISO = `${sYear}-${mdCutoff}`;

    const ytdPrecipTotal = fullDataset
        .filter(d => {
            const p = d.DATE.split('-');
            return parseInt(p[0]) === sYear && d.DATE.slice(5) <= mdCutoff;
        })
        .reduce((sum, d) => sum + convertPrecip(d.PRCP), 0);

    // Average YTD through the same calendar date, across the selected period range
    const ytdRangeS = currentRange.start === 0 ? startYear : currentRange.start;
    const ytdRangeE = currentRange.end >= 9000 ? endYear : currentRange.end;

    const ytdByYear = allYears
        .filter(y => y >= ytdRangeS && y <= ytdRangeE)
        .map(y => ({
            year: y,
            total: fullDataset
                .filter(d => {
                    const p = d.DATE.split('-');
                    return parseInt(p[0]) === y && d.DATE.slice(5) <= mdCutoff;
                })
                .reduce((sum, d) => sum + convertPrecip(d.PRCP), 0)
        }));

    const avgYtdPrecip = ytdByYear.length
        ? ytdByYear.reduce((s, r) => s + r.total, 0) / ytdByYear.length
        : null;

    const ytdDelta       = avgYtdPrecip !== null ? ytdPrecipTotal - avgYtdPrecip : null;
    const ytdPctNormal   = (avgYtdPrecip !== null && avgYtdPrecip > 0) ? (ytdPrecipTotal / avgYtdPrecip) * 100 : null;
    const ytdPctAnnual   = (avgYearPrecip !== null && avgYearPrecip > 0) ? (ytdPrecipTotal / avgYearPrecip) * 100 : null;

    const deltaColor = ytdDelta === null ? 'var(--sub-text)'
        : ytdDelta > 0.005 ? '#0984e3'    // surplus — blue
        : ytdDelta < -0.005 ? '#d63031'   // deficit — red
        : 'var(--sub-text)';

    const deltaSign = ytdDelta !== null && ytdDelta > 0.005 ? '+' : '';

    const ytdLabel = sYear === systemYear
        ? `${sYear} Year-to-Date Precipitation`
        : `${sYear} Precipitation through ${monthName} ${dReq}`;
    const ytdAvgLabel = `Average through ${monthName} ${dReq} ${rangeHtml}`;

    document.getElementById('ytdPrecipLabel').innerHTML = ytdLabel;
    document.getElementById('ytdPrecip').textContent = fmtPrecip(ytdPrecipTotal);

    document.getElementById('ytdAvgPrecipLabel').innerHTML = ytdAvgLabel;
    document.getElementById('ytdAvgPrecip').textContent = avgYtdPrecip !== null ? fmtPrecip(avgYtdPrecip) : '--';

    document.getElementById('ytdDeltaLabel').innerHTML =
        `Year-to-Date Surplus / Deficit through ${monthName} ${dReq} ${rangeHtml}`;
    const ytdDeltaEl = document.getElementById('ytdDelta');
    ytdDeltaEl.textContent = ytdDelta !== null ? `${deltaSign}${fmtPrecip(ytdDelta)}` : '--';
    ytdDeltaEl.style.color = deltaColor;

    document.getElementById('ytdPctNormalLabel').innerHTML =
        `Percent of Normal Year-to-Date through ${monthName} ${dReq} ${rangeHtml}`;
    const ytdPctNormalEl = document.getElementById('ytdPctNormal');
    ytdPctNormalEl.textContent = ytdPctNormal !== null ? `${ytdPctNormal.toFixed(0)}%` : '--';
    ytdPctNormalEl.style.color = ytdPctNormal === null ? 'var(--sub-text)'
        : ytdPctNormal >= 110 ? '#0984e3'
        : ytdPctNormal <= 90  ? '#d63031'
        : 'var(--sub-text)';

    document.getElementById('ytdPctAnnualLabel').innerHTML =
        `Year-to-Date as % of Average Annual Precipitation ${rangeHtml}`;
    document.getElementById('ytdPctAnnual').textContent =
        ytdPctAnnual !== null ? `${ytdPctAnnual.toFixed(0)}%` : '--';

    // MONTH-TO-DATE PRECIPITATION
    // Sum from the 1st of the selected month through the selected day
    const mtdPrecipTotal = fullDataset
        .filter(d => {
            const p = d.DATE.split('-');
            return parseInt(p[0]) === sYear
                && parseInt(p[1]) === mIdx
                && parseInt(p[2]) <= dReq;
        })
        .reduce((sum, d) => sum + convertPrecip(d.PRCP), 0);

    // Average MTD through the same day-of-month across the selected period range
    const mtdByYear = allYears
        .filter(y => y >= ytdRangeS && y <= ytdRangeE)
        .map(y => ({
            year: y,
            total: fullDataset
                .filter(d => {
                    const p = d.DATE.split('-');
                    return parseInt(p[0]) === y
                        && parseInt(p[1]) === mIdx
                        && parseInt(p[2]) <= dReq;
                })
                .reduce((sum, d) => sum + convertPrecip(d.PRCP), 0)
        }));

    const avgMtdPrecip = mtdByYear.length
        ? mtdByYear.reduce((s, r) => s + r.total, 0) / mtdByYear.length
        : null;

    const mtdDelta     = avgMtdPrecip !== null ? mtdPrecipTotal - avgMtdPrecip : null;
    const mtdPctNormal = (avgMtdPrecip !== null && avgMtdPrecip > 0) ? (mtdPrecipTotal / avgMtdPrecip) * 100 : null;

    const mtdDeltaColor = mtdDelta === null ? 'var(--sub-text)'
        : mtdDelta > 0.005 ? '#0984e3'
        : mtdDelta < -0.005 ? '#d63031'
        : 'var(--sub-text)';
    const mtdDeltaSign = mtdDelta !== null && mtdDelta > 0.005 ? '+' : '';

    document.getElementById('mtdPrecipLabel').innerHTML =
        `${monthName} 1–${dReq}, ${sYear} Precipitation`;
    document.getElementById('mtdPrecip').textContent = fmtPrecip(mtdPrecipTotal);

    document.getElementById('mtdAvgPrecipLabel').innerHTML =
        `Average ${monthName} 1–${dReq} Precipitation ${rangeHtml}`;
    document.getElementById('mtdAvgPrecip').textContent =
        avgMtdPrecip !== null ? fmtPrecip(avgMtdPrecip) : '--';

    document.getElementById('mtdDeltaLabel').innerHTML =
        `${monthName} 1–${dReq} Surplus / Deficit ${rangeHtml}`;
    const mtdDeltaEl = document.getElementById('mtdDelta');
    mtdDeltaEl.textContent = mtdDelta !== null ? `${mtdDeltaSign}${fmtPrecip(mtdDelta)}` : '--';
    mtdDeltaEl.style.color = mtdDeltaColor;

    document.getElementById('mtdPctNormalLabel').innerHTML =
        `Percent of Normal ${monthName} 1–${dReq} Precipitation ${rangeHtml}`;
    const mtdPctNormalEl = document.getElementById('mtdPctNormal');
    mtdPctNormalEl.textContent = mtdPctNormal !== null ? `${mtdPctNormal.toFixed(0)}%` : '--';
    mtdPctNormalEl.style.color = mtdPctNormal === null ? 'var(--sub-text)'
        : mtdPctNormal >= 110 ? '#0984e3'
        : mtdPctNormal <= 90  ? '#d63031'
        : 'var(--sub-text)';

// 4. SELECTED MONTH ACTUAL AVERAGE — the selected year's average for the selected month,
    // with a "Latest Data" tag when it's the current, still-in-progress month, and a departure
    // badge comparing it against the climate-normal average for that calendar month.
    const selMonthYearData = rawMonthData.filter(d => d.year === sYear);
    const selValidDays = selMonthYearData.filter(d => d.tmin !== null || d.tmax !== null).map(d => d.day);
    let selMonthLatestTag = "";
    if (isCurrentPartialMonth && selValidDays.length > 0) {
        selMonthLatestTag = `<br><span style="font-size:0.65rem; color:var(--sub-text); font-weight:400;">Latest Data: ${monthName} ${Math.max(...selValidDays)}, ${sYear}</span>`;
    }

    const selMonthMinVals = selMonthYearData.map(r => convert(r.tmin)).filter(v => v !== null);
    const selMonthMaxVals = selMonthYearData.map(r => convert(r.tmax)).filter(v => v !== null);
    const selMonthMinAvg = selMonthMinVals.length ? selMonthMinVals.reduce((a, b) => a + b, 0) / selMonthMinVals.length : null;
    const selMonthMaxAvg = selMonthMaxVals.length ? selMonthMaxVals.reduce((a, b) => a + b, 0) / selMonthMaxVals.length : null;

    document.getElementById('currMonthMinLabel').innerHTML = `${monthName} ${sYear} Average Minimum Temperature ${selMonthLatestTag}`;
    document.getElementById('currMonthMaxLabel').innerHTML = `${monthName} ${sYear} Average Maximum Temperature ${selMonthLatestTag}`;
    document.getElementById('currMonthMin').textContent = selMonthMinAvg !== null ? selMonthMinAvg.toFixed(1) + unit : "--";
    document.getElementById('currMonthMax').textContent = selMonthMaxAvg !== null ? selMonthMaxAvg.toFixed(1) + unit : "--";

    // Reference distribution for the departure badge: one average per normals-period year for this calendar month
    const monthlyYearGroups = {};
    periodData.forEach(r => {
        if (!monthlyYearGroups[r.year]) monthlyYearGroups[r.year] = { tmax: [], tmin: [] };
        if (r.tmax !== null) monthlyYearGroups[r.year].tmax.push(convert(r.tmax));
        if (r.tmin !== null) monthlyYearGroups[r.year].tmin.push(convert(r.tmin));
    });
    const monthlyYearAvgsMax = Object.values(monthlyYearGroups)
        .map(g => g.tmax.length ? g.tmax.reduce((a, b) => a + b, 0) / g.tmax.length : null)
        .filter(v => v !== null);
    const monthlyYearAvgsMin = Object.values(monthlyYearGroups)
        .map(g => g.tmin.length ? g.tmin.reduce((a, b) => a + b, 0) / g.tmin.length : null)
        .filter(v => v !== null);

    updateDepartureBadge('currMonthMinDep', selMonthMinAvg, document.getElementById('monMin').textContent, monthlyYearAvgsMin, 'monthly average');
    updateDepartureBadge('currMonthMaxDep', selMonthMaxAvg, document.getElementById('monMax').textContent, monthlyYearAvgsMax, 'monthly average');

    // 5. BOX & LINE TREND PLOTS
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const baseLayout = { 
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: isDark ? "#e0e0e0" : "#2d3436", family: 'Inter, sans-serif', size: 10 },
      yaxis: { title: unit, gridcolor: isDark ? "#333" : "#f1f2f6", zeroline: false }, 
      margin: { t: 60, b: 40, l: 40, r: 20 }, template: isDark ? 'plotly_dark' : 'plotly_white'
    };

    if(dailyRows.length > 0) {
      // Create year arrays that match the filtered temperature points
      const yearsMin = dailyRows.filter(r => r.tmin !== null).map(r => r.year);
      const yearsMax = dailyRows.filter(r => r.tmax !== null).map(r => r.year);
      const tmaxStd = getStdDev(dailyReferenceValues.tmax);
      const tminStd = getStdDev(dailyReferenceValues.tmin);
      const xYears = dailyRows.map(r => r.year);

      Plotly.newPlot('boxDiv', [
        { 
            y: dailyReferenceValues.tmin, 
            text: yearsMin, // Restores the year metadata
            type:'box', 
            name:'Minimum', 
            boxpoints: 'all', 
            jitter: 0.5, 
            pointpos: -1.8, 
            marker: {color: '#74b9ff'},
            hovertemplate: 'Year: %{text}<br>Temp: %{y:.1f}' + unit + '<extra></extra>'
        },
        { 
            y: dailyReferenceValues.tmax, 
            text: yearsMax, // Restores the year metadata
            type:'box', 
            name:'Maximum', 
            boxpoints: 'all', 
            jitter: 0.5, 
            pointpos: 1.8, 
            marker: {color: '#ff7675'},
            hovertemplate: 'Year: %{text}<br>Temp: %{y:.1f}' + unit + '<extra></extra>'
        }
      ], { ...baseLayout, title: {
            text: `<b>${monthName} ${dReq} Temperature Distribution (${rangeText})</b><br>${lastStation.name}, ${lastStation.state}`,
            x: 0.5,
            xanchor: 'center'
      }
        });
      Plotly.newPlot('lineDiv', [
          // --- LAYER 1: Normal Range Ribbons (Background) ---
          {
              x: xYears.concat([...xYears].reverse()),
              y: Array(xYears.length).fill(parseFloat(finalAvgMax) + tmaxStd)
                  .concat(Array(xYears.length).fill(parseFloat(finalAvgMax) - tmaxStd).reverse()),
              fill: 'toself',
              fillcolor: 'rgba(255, 118, 117, 0.1)',
              line: {color: 'transparent'},
              name: 'Normal Range (Max)',
              showlegend: false, // Cleaner: hide the "shading" from the legend
              hoverinfo: 'skip'
          },
          {
              x: xYears.concat([...xYears].reverse()),
              y: Array(xYears.length).fill(parseFloat(finalAvgMin) + tminStd)
                  .concat(Array(xYears.length).fill(parseFloat(finalAvgMin) - tminStd).reverse()),
              fill: 'toself',
              fillcolor: 'rgba(116, 185, 255, 0.1)',
              line: {color: 'transparent'},
              name: 'Normal Range (Min)',
              showlegend: false, // Cleaner: hide the "shading" from the legend
              hoverinfo: 'skip'
          },
          // --- LAYER 2: Dashed Normal Reference Lines ---
          {
              x: xYears,
              y: Array(xYears.length).fill(finalAvgMin),
              type: 'scatter', mode: 'lines',
              name: `Normal Min Temp (${rangeText})`,
              line: {color: '#74b9ff', dash: 'dot', width: 1.5},
              legendrank: 1001,
              connectgaps: true, hoverinfo: 'skip'
          },
          {
              x: xYears,
              y: Array(xYears.length).fill(finalAvgMax),
              type: 'scatter', mode: 'lines',
              name: `Normal Max Temp (${rangeText})`,
              line: {color: '#ff7675', dash: 'dot', width: 1.5},
              legendrank: 1000, // Higher number = pushes to the end of the legend
              connectgaps: true, hoverinfo: 'skip'
          },

          // --- LAYER 3: Historical Data Lines (Foreground) ---
          { 
              x: xYears, 
              y: dailyReferenceValues.tmin, 
              text: dailyRows.map(r => getSigmaClassification(convert(r.tmin), finalAvgMin, dailyReferenceValues.tmin)),
              type: 'scatter', 
              name: 'Minimum Temperature', 
              line: {color: '#74b9ff', width: 2},
              legendrank: 11,
              hovertemplate: 'Year: %{x}<br>Temp: %{y:.1f}' + unit + '<br><b>%{text}</b><extra></extra>'
          },
          { 
              x: xYears, 
              y: dailyReferenceValues.tmax, 
              text: dailyRows.map(r => getSigmaClassification(convert(r.tmax), finalAvgMax, dailyReferenceValues.tmax)),
              type: 'scatter', 
              name: 'Maximum Temperature', 
              line: {color: '#ff7675', width: 2},
              legendrank: 10, // Lower number = stays at the front
              hovertemplate: 'Year: %{x}<br>Temp: %{y:.1f}' + unit + '<br><b>%{text}</b><extra></extra>'
          }

      ], { 
          ...baseLayout, 
          title: {
            text: `<b>${monthName} ${dReq} Temperature Historical Trend (${rangeText})</b><br>${lastStation.name}, ${lastStation.state}`,
            x: 0.5,
            xanchor: 'center',
          },
            margin: { ...baseLayout.margin, b: 80 },
            legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.4 }
      });
    }
    // 6. CONTEXT WINDOW — 6 years total, ideally 3 years each side.
    //    If selected date is recent, cap the forward end at today and
    //    redistribute unused forward days to the backward window.
    const selectedDate = new Date(sYear, mIdx - 1, dReq, 12);
    const today = new Date(); today.setHours(23, 59, 59, 0);
    const TOTAL_DAYS = 6 * 365;
    const idealForwardMs = selectedDate.getTime() + 3 * 365 * 86400000;
    const actualForwardMs = Math.min(idealForwardMs, today.getTime());
    const forwardDays = Math.round((actualForwardMs - selectedDate.getTime()) / 86400000);
    const backwardDays = TOTAL_DAYS - forwardDays;

    const windowDates = [];
    for (let i = -backwardDays; i <= forwardDays; i++) {
        const d = new Date(selectedDate.getTime() + i * 86400000);
        windowDates.push(d.toISOString().split('T')[0]);
    }

    // Fast data lookup by date string
    const dataByDate = {};
    fullDataset.forEach(r => { if (r.DATE) dataByDate[r.DATE] = r; });

    // Rows for each window date (null for missing/future dates)
    const windowRows = windowDates.map(iso => dataByDate[iso] || null);

    // Efficient: precompute M/D averages only once per unique calendar day (≤366)
    const rangeS = currentRange.start === 0 ? 1900 : currentRange.start;
    const rangeE = currentRange.end >= 9000 ? 2025 : currentRange.end;
    const mdAvgCache = {};
    [...new Set(windowDates.map(d => d.slice(5)))].forEach(md => {
        const [m, day] = md.split('-').map(Number);
        const matches = fullDataset.filter(row => {
            const p = row.DATE.toString().split('-');
            return parseInt(p[1]) === m && parseInt(p[2]) === day &&
                   parseInt(p[0]) >= rangeS && parseInt(p[0]) <= rangeE;
        });
        const tmaxVals = matches.map(r => convert(r.TMAX / 10)).filter(v => v !== null);
        const tminVals = matches.map(r => convert(r.TMIN / 10)).filter(v => v !== null);
        mdAvgCache[md] = {
            avgMax: tmaxVals.length ? tmaxVals.reduce((a, b) => a + b, 0) / tmaxVals.length : null,
            avgMin: tminVals.length ? tminVals.reduce((a, b) => a + b, 0) / tminVals.length : null,
            stdMax: getStdDev(tmaxVals),
            stdMin: getStdDev(tminVals)
        };
    });

    const historicalAverages = windowDates.map(iso => mdAvgCache[iso.slice(5)]);

    // --- 7. UPDATED GATEKEEPER: LIVE OR HISTORICAL OBSERVATION ---
    const todayBtn = document.getElementById('todayBtn');
    const isToday = (mIdx === (todayDate.getMonth() + 1)) && (dReq === todayDate.getDate()) && (sYear === systemYear);

    if (isToday) {
        todayBtn.classList.add('is-today');
        liveRow.style.display = 'flex';
        document.getElementById('liveMinLabel').innerHTML = `Today's Observed / Forecast Minimum Temperature`;
        document.getElementById('liveMaxLabel').innerHTML = `Today's Observed / Forecast Maximum Temperature`;
        document.getElementById('liveMin').textContent = '…';
        document.getElementById('liveMax').textContent = '…';
        document.getElementById('liveMinDep').textContent = 'Fetching live data…';
        document.getElementById('liveMaxDep').textContent = 'Fetching live data…';
        fetchLiveComparison(lastStation.lat, lastStation.lon, finalAvgMax, finalAvgMin);
    } else {
        todayBtn.classList.remove('is-today');
        const historicalObs = rawMonthData.find(d => d.year === sYear && d.day === dReq);
        const liveRow = document.getElementById('liveRow');

        if (historicalObs && (historicalObs.tmin !== null || historicalObs.tmax !== null)) {
            liveRow.style.display = 'flex';
            
            const dispHigh = convert(historicalObs.tmax);
            const dispLow = convert(historicalObs.tmin);
            const datePrefix = `${monthName} ${dReq}, ${sYear}`;

            document.getElementById('liveMin').textContent = dispLow !== null ? dispLow.toFixed(1) + unit : "--";
            document.getElementById('liveMax').textContent = dispHigh !== null ? dispHigh.toFixed(1) + unit : "--";

            document.getElementById('liveMinLabel').innerHTML = `${datePrefix} Observed Minimum Temperature`;
            document.getElementById('liveMaxLabel').innerHTML = `${datePrefix} Observed Maximum Temperature`;

            updateDepartureBadge('liveMinDep', dispLow, finalAvgMin, dailyReferenceValues.tmin);
            updateDepartureBadge('liveMaxDep', dispHigh, finalAvgMax, dailyReferenceValues.tmax);
        } else {
            liveRow.style.display = 'none';
        }
    }
    // FROST / FREEZE MEDIAN DATES — respects selected period range
    const frostRangeS = currentRange.start === 0 ? startYear : currentRange.start;
    const frostRangeE = currentRange.end >= 9000 ? endYear : currentRange.end;

    const frostThresholds = [
        { labelPre: 'Frost',       f: 36, lastId: 'lastFrost',      firstId: 'firstFrost',      lastLbl: 'lastFrostLabel',      firstLbl: 'firstFrostLabel'      },
        { labelPre: 'Freeze',      f: 32, lastId: 'lastFreeze',     firstId: 'firstFreeze',     lastLbl: 'lastFreezeLabel',     firstLbl: 'firstFreezeLabel'     },
        { labelPre: 'Hard Freeze', f: 28, lastId: 'lastHardFreeze', firstId: 'firstHardFreeze', lastLbl: 'lastHardFreezeLabel', firstLbl: 'firstHardFreezeLabel' },
    ];
    const frostUnitNote = (f) => {
        const c = Math.round((f - 32) * 5/9);
        return yearSmall(`≤${f}°F / ${c}°C`);
    };
    const noFrostMsg = (type) => `No ${type.toLowerCase()} at this location`;

    frostThresholds.forEach(({ labelPre, f, lastId, firstId, lastLbl, firstLbl }) => {
        const springResult = medianFrostDate(f, 'spring', frostRangeS, frostRangeE);
        const fallResult   = medianFrostDate(f, 'fall',   frostRangeS, frostRangeE);

        document.getElementById(lastLbl).innerHTML =
            `Average Last Spring ${labelPre} Date ${frostUnitNote(f)} ${rangeHtml}`;
        document.getElementById(lastId).textContent =
            springResult === 'none' ? noFrostMsg(labelPre)
            : springResult === null ? '--'
            : springResult;

        document.getElementById(firstLbl).innerHTML =
            `Average First Fall ${labelPre} Date ${frostUnitNote(f)} ${rangeHtml}`;
        document.getElementById(firstId).textContent =
            fallResult === 'none' ? noFrostMsg(labelPre)
            : fallResult === null ? '--'
            : fallResult;
    });

    renderWindowCharts(windowRows, historicalAverages, sYear, windowDates, rangeText, selectedDate);
    renderClimatograph(rangeText);
    renderDailyClimatograph(rangeText, sYear);
    updateThresholdCard();
    hideSpinner();
}

function updateThresholdCard() {
    if (!fullDataset) return;
    const isF = document.getElementById('unitToggle').checked;
    const unit = isF ? "°F" : "°C";
    const convert = (v) => (v == null ? null : (isF ? (v * 9/5 + 32) : v));
    const sYear = parseInt(document.getElementById('yearSelect').value);

    const compare = document.getElementById('threshCompare').value; // 'above' | 'below'
    const field = document.getElementById('threshField').value; // 'TMAX' | 'TMIN'
    const fieldLabel = field === 'TMAX' ? 'Max Temp' : 'Min Temp';
    const threshold = parseFloat(document.getElementById('threshTemp').value);

    document.getElementById('threshUnitLabel').textContent = unit;

    const countLabelEl = document.getElementById('threshCountLabel');
    const countEl = document.getElementById('threshCount');
    const normalLabelEl = document.getElementById('threshNormalLabel');
    const normalEl = document.getElementById('threshNormal');
    const depEl = document.getElementById('threshDep');
    const latestEl = document.getElementById('threshLatestData');

    // Latest data date available for the selected year, so it's clear how much of the year is counted
    const yearRowsAll = fullDataset.filter(d => d.DATE && parseInt(d.DATE.split('-')[0]) === sYear);
    let latestDate = null;
    yearRowsAll.forEach(d => { if (!latestDate || d.DATE > latestDate) latestDate = d.DATE; });
    if (latestDate) {
        const [ly, lm, ld] = latestDate.split('-').map(Number);
        latestEl.textContent = `Latest Data for ${sYear}: ${monthNames[lm - 1]} ${ld}, ${ly}`;
    } else {
        latestEl.textContent = `No data available for ${sYear}`;
    }

    if (isNaN(threshold)) {
        countEl.textContent = '--';
        normalEl.textContent = '--';
        depEl.textContent = '';
        return;
    }

    const meetsCondition = (v) => compare === 'above' ? v > threshold : v < threshold;
    const compareLabel = compare === 'above' ? 'Above' : 'Below';

    // Count of qualifying days for the selected year
    const yearRows = fullDataset.filter(d => d.DATE && parseInt(d.DATE.split('-')[0]) === sYear);
    const yearVals = yearRows.map(d => convert(d[field] != null ? d[field] / 10 : null)).filter(v => v !== null);
    const yearCount = yearVals.filter(meetsCondition).length;

    // Normal — average qualifying-day count per year across the selected climate-normal period
    const rangeS = currentRange.start === 0 ? 1900 : currentRange.start;
    const rangeE = currentRange.end >= 9000 ? 2025 : currentRange.end;
    const rangeText = currentRange.start === 0 ? 'All Data' : `${currentRange.start}-${currentRange.end}`;

    const countsByYear = {};
    fullDataset.forEach(d => {
        if (!d.DATE) return;
        const y = parseInt(d.DATE.split('-')[0]);
        if (y < rangeS || y > rangeE) return;
        const raw = d[field];
        if (raw == null) return;
        if (!(y in countsByYear)) countsByYear[y] = 0;
        if (meetsCondition(convert(raw / 10))) countsByYear[y]++;
    });
    const normalCounts = Object.values(countsByYear);
    const avgCount = normalCounts.length ? normalCounts.reduce((a, b) => a + b, 0) / normalCounts.length : null;

    countLabelEl.textContent = `Days ${compareLabel} ${threshold}${unit} (${fieldLabel}) in ${sYear}`;
    countEl.textContent = `${yearCount} days`;

    normalLabelEl.textContent = `Average Days ${compareLabel} ${threshold}${unit} (${fieldLabel}) — ${rangeText}`;
    normalEl.textContent = avgCount !== null ? `${avgCount.toFixed(1)} days` : '--';

    if (avgCount === null || avgCount === 0) {
        depEl.textContent = '';
    } else {
        const diff = yearCount - avgCount;
        const pct = (yearCount / avgCount) * 100;
        const sign = diff > 0 ? '+' : '';
        depEl.textContent = `${sign}${diff.toFixed(1)} days vs. normal (${pct.toFixed(0)}% of normal)`;
        if (diff > 0.05) depEl.style.color = 'var(--max-color)';
        else if (diff < -0.05) depEl.style.color = 'var(--min-color)';
        else depEl.style.color = 'var(--sub-text)';
    }
}

function renderWindowCharts(windowRows, histAverages, sYear, dates, rangeText, selectedDate) {
    const isF = document.getElementById('unitToggle').checked;
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const tempUnit = isF ? "°F" : "°C";
    const precipUnit = isF ? "in" : "mm";
    const precipDecimals = isF ? 2 : 1;

    const convertTemp = (v) => (v === null || v === undefined ? null : (isF ? (v * 9/5 + 32) : v));
    const convertPrecip = (v) => {
        if (v == null) return null;
        const mm = v / 10;
        const val = isF ? mm * 0.0393701 : mm;
        return val > 0 ? parseFloat(val.toFixed(precipDecimals)) : null;
    };

    const selISO = selectedDate.toISOString().split('T')[0];
    const viewStart = new Date(selectedDate.getTime() - 30 * 86400000).toISOString().split('T')[0];
    const viewEnd   = new Date(selectedDate.getTime() + 30 * 86400000).toISOString().split('T')[0];

    // Jan 1 year annotations
    const jan1Annotations = dates
        .filter(d => d.slice(5) === '01-01')
        .map(d => ({
            x: d, yref: 'paper', y: 1.02, yanchor: 'bottom',
            text: `<b>${d.slice(0, 4)}</b>`,
            showarrow: false, xanchor: 'center',
            font: { size: 10, color: isDark ? '#a0a0a0' : '#636e72' }
        }));

    // Ribbon math — null-safe
    const xDouble = dates.concat([...dates].reverse());
    const maxRibbonY = histAverages.map(h => h.avgMax !== null ? h.avgMax + h.stdMax : null)
        .concat([...histAverages].reverse().map(h => h.avgMax !== null ? h.avgMax - h.stdMax : null));
    const minRibbonY = histAverages.map(h => h.avgMin !== null ? h.avgMin + h.stdMin : null)
        .concat([...histAverages].reverse().map(h => h.avgMin !== null ? h.avgMin - h.stdMin : null));

    const tmaxData = windowRows.map(r => r ? convertTemp(r.TMAX != null ? r.TMAX / 10 : null) : null);
    const tminData = windowRows.map(r => r ? convertTemp(r.TMIN != null ? r.TMIN / 10 : null) : null);

    const tempTraces = [
        { x: xDouble, y: maxRibbonY, fill: 'toself', fillcolor: 'rgba(255,118,117,0.1)', line: {color:'transparent'}, name: 'Normal Range (Max)', showlegend: false, hoverinfo: 'skip' },
        { x: xDouble, y: minRibbonY, fill: 'toself', fillcolor: 'rgba(116,185,255,0.1)', line: {color:'transparent'}, name: 'Normal Range (Min)', showlegend: false, hoverinfo: 'skip' },
        {
            x: dates, y: tmaxData,
            text: tmaxData.map((v, i) => v !== null ? getSigmaClassification(v, histAverages[i].avgMax, dailyReferenceValues.tmax) : ''),
            name: 'Observed Maximum', mode: 'lines+markers',
            line: {color: '#ff7675', width: 2}, marker: {size: 4},
            connectgaps: false,
            hovertemplate: 'Date: %{x}<br>Temp: %{y:.1f}' + tempUnit + '<br><b>%{text}</b><extra></extra>'
        },
        {
            x: dates, y: tminData,
            text: tminData.map((v, i) => v !== null ? getSigmaClassification(v, histAverages[i].avgMin, dailyReferenceValues.tmin) : ''),
            name: 'Observed Minimum', mode: 'lines+markers',
            line: {color: '#74b9ff', width: 2}, marker: {size: 4},
            connectgaps: false,
            hovertemplate: 'Date: %{x}<br>Temp: %{y:.1f}' + tempUnit + '<br><b>%{text}</b><extra></extra>'
        },
        { x: dates, y: histAverages.map(h => h.avgMax), name: 'Normal Maximum', mode: 'lines', line: {color:'#ff7675', dash:'dot', width:1.5}, hovertemplate: 'Normal Max<br>%{x}: %{y:.1f}' + tempUnit + '<extra></extra>' },
        { x: dates, y: histAverages.map(h => h.avgMin), name: 'Normal Minimum', mode: 'lines', line: {color:'#74b9ff', dash:'dot', width:1.5}, hovertemplate: 'Normal Min<br>%{x}: %{y:.1f}' + tempUnit + '<extra></extra>' }
    ];

    // Compute temperature y-axis range from actual data + normals, with 10% padding
    const allTempVals = [
        ...tmaxData.filter(v => v !== null),
        ...tminData.filter(v => v !== null),
        ...histAverages.map(h => h.avgMax).filter(v => v !== null),
        ...histAverages.map(h => h.avgMin).filter(v => v !== null)
    ];
    const tempMin = allTempVals.length ? Math.min(...allTempVals) : (isF ? -20 : -30);
    const tempMax = allTempVals.length ? Math.max(...allTempVals) : (isF ? 120 : 50);
    const tempPad = (tempMax - tempMin) * 0.10;
    const yTempRange = [tempMin - tempPad, tempMax + tempPad];

    const rangeselectorStyle = {
        bgcolor: isDark ? '#2d2d2d' : '#f0f0f0',
        activecolor: '#007bff',
        bordercolor: isDark ? '#444' : '#ccc',
        font: { color: isDark ? '#e0e0e0' : '#2d3436', size: 11 }
    };

    const rangeselectorButtons = [
        { count: 1,  label: '1M',  step: 'month', stepmode: 'backward' },
        { count: 3,  label: '3M',  step: 'month', stepmode: 'backward' },
        { count: 6,  label: '6M',  step: 'month', stepmode: 'backward' },
        { count: 1,  label: '1Y',  step: 'year',  stepmode: 'backward' },
        {            label: 'All', step: 'all' }
    ];

    const baseLayout = {
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: isDark ? '#e0e0e0' : '#636e72', family: 'Inter, sans-serif', size: 11 },
        dragmode: 'pan',
        xaxis: {
            type: 'date',
            range: [viewStart, viewEnd],
            tickangle: -45,
            gridcolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
            automargin: true,
            rangeslider: { visible: false },
            rangeselector: { buttons: rangeselectorButtons, ...rangeselectorStyle, x: 0, y: 1.18 }
        },
        margin: { t: 80, b: 80, l: 55, r: 20 },
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.45 },
        hovermode: 'closest',
        annotations: jan1Annotations
    };

    const plotConfig = {
        scrollZoom: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['select2d','lasso2d','autoScale2d','resetScale2d','toImage','zoomIn2d','zoomOut2d'],
        displaylogo: false
    };

    Plotly.react('windowTempDiv', tempTraces, {
        ...baseLayout,
        title: { text: `<b>${sYear} Temperature vs ${rangeText} Normals</b><br>${lastStation.name}, ${lastStation.state}`, x: 0.5, xanchor: 'center' },
        yaxis: { title: tempUnit, range: yTempRange, gridcolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }
    }, plotConfig);

    // Precipitation
    const precipData = windowRows.map(r => r ? convertPrecip(r.PRCP) : null);
    const maxPrecip = Math.max(0, ...precipData.filter(v => v !== null));
    const precipYMax = maxPrecip > 0 ? maxPrecip * 1.15 : 1;

    const precipTrace = {
        x: dates, y: precipData,
        type: 'bar',
        marker: { color: '#0984e3', opacity: 0.7, line: { width: 0 } },
        name: 'Daily Precip',
        hovertemplate: `%{x}<br>%{y} ${precipUnit}<extra></extra>`
    };

    const calcVisiblePrecip = (r0, r1) => {
        let total = 0;
        for (let i = 0; i < dates.length; i++) {
            if (dates[i] >= r0 && dates[i] <= r1 && precipData[i] !== null) total += precipData[i];
        }
        return total.toFixed(precipDecimals) + ' ' + precipUnit;
    };

    const precipTitle = (total) =>
        `<b>${sYear} Precipitation (Total: ${total})</b><br>${lastStation.name}, ${lastStation.state}`;

    const initialTotal = calcVisiblePrecip(viewStart, viewEnd);

    Plotly.react('windowPrecipDiv', [precipTrace], {
        ...baseLayout,
        title: { text: precipTitle(initialTotal), x: 0.5, xanchor: 'center' },
        yaxis: {
            title: precipUnit,
            range: [0, precipYMax],
            fixedrange: true,       // lock y — prevents negative zoom and hover artifacts
            gridcolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
            zeroline: false
        }
    }, plotConfig);

    // Update precip title on zoom/pan — flag prevents the title relayout from re-triggering itself
    const precipDiv = document.getElementById('windowPrecipDiv');
    precipDiv.removeAllListeners && precipDiv.removeAllListeners('plotly_relayout');
    let precipTitleTimer = null;
    let precipTitleUpdating = false;
    precipDiv.on('plotly_relayout', (ev) => {
        if (precipTitleUpdating) return;
        const r0 = (ev['xaxis.range[0]'] || '').split(' ')[0];
        const r1 = (ev['xaxis.range[1]'] || '').split(' ')[0];
        if (!r0 || !r1) return;
        clearTimeout(precipTitleTimer);
        precipTitleTimer = setTimeout(() => {
            precipTitleUpdating = true;
            Plotly.relayout('windowPrecipDiv', { 'title.text': precipTitle(calcVisiblePrecip(r0, r1)) })
                .then(() => { precipTitleUpdating = false; });
        }, 200);
    });

    Plotly.Plots.resize('windowTempDiv');
    Plotly.Plots.resize('windowPrecipDiv');
}

  
  window.addEventListener('resize', () => { 
      const charts = ['boxDiv', 'lineDiv', 'windowTempDiv', 'windowPrecipDiv', 'climatoDiv', 'dailyClimatoDiv'];
      charts.forEach(id => {
          const el = document.getElementById(id);
          if (el) Plotly.Plots.resize(el);
      });
  });

  function renderClimatograph(rangeText) {
    if (!fullDataset || !lastStation) return;
    const isF = document.getElementById('unitToggle').checked;
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const tempUnit = isF ? '°F' : '°C';
    const precipUnit = isF ? 'in' : 'mm';
    const convert = (v) => v == null ? null : (isF ? v * 9/5 + 32 : v);
    const convertPrecip = (v) => {
        if (v == null) return null;
        const mm = v / 10;
        return isF ? mm * 0.0393701 : mm;
    };

    let rangeS = currentRange.start === 0 ? 1900 : currentRange.start;
    let rangeE = currentRange.end >= 9000 ? 2025 : currentRange.end;

    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const avgMaxByMonth = [], avgMinByMonth = [], avgPrecipByMonth = [];

    for (let m = 1; m <= 12; m++) {
        const rows = fullDataset.filter(d => {
            const p = d.DATE.split('-');
            return parseInt(p[1]) === m && parseInt(p[0]) >= rangeS && parseInt(p[0]) <= rangeE;
        });
        const yearMap = {};
        rows.forEach(r => {
            const y = parseInt(r.DATE.split('-')[0]);
            if (!yearMap[y]) yearMap[y] = { tmax: [], tmin: [], prcp: 0 };
            if (r.TMAX != null) yearMap[y].tmax.push(convert(r.TMAX / 10));
            if (r.TMIN != null) yearMap[y].tmin.push(convert(r.TMIN / 10));
            if (r.PRCP != null) yearMap[y].prcp += convertPrecip(r.PRCP) ?? 0;
        });
        const years = Object.values(yearMap);
        const avg = arr => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : null;
        avgMaxByMonth.push(avg(years.map(y => avg(y.tmax)).filter(v => v !== null)));
        avgMinByMonth.push(avg(years.map(y => avg(y.tmin)).filter(v => v !== null)));
        avgPrecipByMonth.push(avg(years.map(y => y.prcp)));
    }

    const traces = [
        {
            x: monthLabels, y: avgPrecipByMonth,
            type: 'bar',
            name: 'Avg Monthly Precip',
            marker: { color: 'rgba(9,132,227,0.55)', line: { width: 0 } },
            yaxis: 'y',
            hovertemplate: '%{x}<br>Avg Precip: %{y:.2f}' + precipUnit + '<extra></extra>'
        },
        {
            x: monthLabels, y: avgMaxByMonth,
            type: 'scatter', mode: 'lines+markers',
            name: 'Avg Monthly Max Temp',
            line: { color: '#ff7675', width: 2.5 }, marker: { size: 6 },
            yaxis: 'y2',
            hovertemplate: '%{x}<br>Avg Max: %{y:.1f}' + tempUnit + '<extra></extra>'
        },
        {
            x: monthLabels, y: avgMinByMonth,
            type: 'scatter', mode: 'lines+markers',
            name: 'Avg Monthly Min Temp',
            line: { color: '#74b9ff', width: 2.5 }, marker: { size: 6 },
            yaxis: 'y2',
            hovertemplate: '%{x}<br>Avg Min: %{y:.1f}' + tempUnit + '<extra></extra>'
        }
    ];

    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: isDark ? '#e0e0e0' : '#636e72', family: 'Inter, sans-serif', size: 11 },
        title: {
            text: `<b>Monthly Climate Normals (${rangeText})</b><br>${lastStation.name}, ${lastStation.state}`,
            x: 0.5, xanchor: 'center'
        },
        xaxis: { gridcolor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)' },
        yaxis: {
            title: precipUnit,
            side: 'right',
            rangemode: 'nonnegative',
            gridcolor: 'transparent',
            zeroline: false,
            showgrid: false,
            automargin: true
        },
        yaxis2: {
            title: tempUnit,
            overlaying: 'y',
            side: 'left',
            zeroline: false,
            gridcolor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
            automargin: true
        },
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.15 },
        margin: { t: 70, b: 60, l: 60, r: 60 },
        bargap: 0.2
    };

    Plotly.react('climatoDiv', traces, layout, { displayModeBar: false, responsive: true });
    // Force resize after layout settles to fix half-render on first load
    requestAnimationFrame(() => Plotly.Plots.resize('climatoDiv'));
  }

  function renderDailyClimatograph(rangeText, sYear) {
    if (!fullDataset || !lastStation) return;
    const isF = document.getElementById('unitToggle').checked;
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const tempUnit = isF ? '°F' : '°C';
    const precipUnit = isF ? 'in' : 'mm';
    const convert = (v) => v == null ? null : (isF ? v * 9/5 + 32 : v);
    const convertPrecip = (v) => {
        if (v == null) return null;
        const mm = v / 10;
        return isF ? mm * 0.0393701 : mm;
    };

    let rangeS = currentRange.start === 0 ? 1900 : currentRange.start;
    let rangeE = currentRange.end >= 9000 ? 2025 : currentRange.end;

    // Ordered list of calendar dates for one reference leap year, so Feb 29 lines up in the right spot
    const refYear = 2024;
    const dates = [];
    for (let i = 0; i < 366; i++) {
        const d = new Date(refYear, 0, 1 + i);
        if (d.getFullYear() !== refYear) break;
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        dates.push(`${refYear}-${mm}-${dd}`);
    }

    // Aggregate tmax/tmin/prcp by calendar day (MM-DD) across years in the selected normals period
    const dayMap = {};
    dates.forEach(iso => { dayMap[iso.slice(5)] = { tmax: [], tmin: [], prcp: [] }; });

    fullDataset.forEach(d => {
        if (!d.DATE) return;
        const p = d.DATE.split('-');
        const y = parseInt(p[0]);
        if (y < rangeS || y > rangeE) return;
        const md = `${p[1]}-${p[2]}`;
        if (!dayMap[md]) return;
        if (d.TMAX != null) dayMap[md].tmax.push(convert(d.TMAX / 10));
        if (d.TMIN != null) dayMap[md].tmin.push(convert(d.TMIN / 10));
        if (d.PRCP != null) dayMap[md].prcp.push(convertPrecip(d.PRCP));
    });

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    const avgMaxByDay = dates.map(iso => avg(dayMap[iso.slice(5)].tmax));
    const avgMinByDay = dates.map(iso => avg(dayMap[iso.slice(5)].tmin));
    const avgPrecipByDay = dates.map(iso => avg(dayMap[iso.slice(5)].prcp));

    // Cumulative precipitation across the year, built from the daily normal averages —
    // reaches the average annual total by December 31
    let running = 0;
    const cumulativePrecip = avgPrecipByDay.map(v => {
        running += (v ?? 0);
        return parseFloat(running.toFixed(2));
    });

    // Actual data for the selected year — mapped onto the same MM-DD reference dates so it overlays
    // the normals correctly. For a past, complete year this spans Jan 1 - Dec 31; for the current,
    // still-in-progress year it naturally stops at the latest recorded date (year-to-date).
    const yearTmaxByMD = {}, yearTminByMD = {}, yearPrcpByMD = {};
    let latestYearMD = null;
    fullDataset.forEach(d => {
        if (!d.DATE) return;
        const p = d.DATE.split('-');
        if (parseInt(p[0]) !== sYear) return;
        const md = `${p[1]}-${p[2]}`;
        if (!latestYearMD || md > latestYearMD) latestYearMD = md;
        if (d.TMAX != null) yearTmaxByMD[md] = convert(d.TMAX / 10);
        if (d.TMIN != null) yearTminByMD[md] = convert(d.TMIN / 10);
        if (d.PRCP != null) yearPrcpByMD[md] = convertPrecip(d.PRCP);
    });

    const actualMaxByDay = dates.map(iso => {
        const md = iso.slice(5);
        return md in yearTmaxByMD ? yearTmaxByMD[md] : null;
    });
    const actualMinByDay = dates.map(iso => {
        const md = iso.slice(5);
        return md in yearTminByMD ? yearTminByMD[md] : null;
    });

    // Actual cumulative precip for the selected year, treating missing daily readings as 0 so a gap
    // doesn't break the running total, but stopping once we're past the last recorded date of the year
    let actualRunning = 0;
    const actualCumulativePrecip = dates.map(iso => {
        const md = iso.slice(5);
        if (!latestYearMD || md > latestYearMD) return null;
        actualRunning += (yearPrcpByMD[md] || 0);
        return parseFloat(actualRunning.toFixed(2));
    });

    const traces = [
        {
            x: dates, y: cumulativePrecip,
            type: 'bar',
            name: 'Cumulative Avg Precip',
            marker: { color: 'rgba(9,132,227,0.55)', line: { width: 0 } },
            yaxis: 'y',
            hovertemplate: '%{x}<br>Cumulative Precip: %{y:.2f}' + precipUnit + '<extra></extra>'
        },
        {
            x: dates, y: actualCumulativePrecip,
            type: 'scatter', mode: 'lines',
            name: `${sYear} Cumulative Precip`,
            line: { color: '#08306b', width: 2.5 },
            yaxis: 'y',
            connectgaps: true,
            hovertemplate: '%{x}<br>' + sYear + ' Cumulative Precip: %{y:.2f}' + precipUnit + '<extra></extra>'
        },
        {
            x: dates, y: avgMaxByDay,
            type: 'scatter', mode: 'lines',
            name: 'Avg Daily Max Temp',
            line: { color: '#ff7675', width: 2 },
            yaxis: 'y2',
            connectgaps: true,
            hovertemplate: '%{x}<br>Avg Max: %{y:.1f}' + tempUnit + '<extra></extra>'
        },
        {
            x: dates, y: avgMinByDay,
            type: 'scatter', mode: 'lines',
            name: 'Avg Daily Min Temp',
            line: { color: '#74b9ff', width: 2 },
            yaxis: 'y2',
            connectgaps: true,
            hovertemplate: '%{x}<br>Avg Min: %{y:.1f}' + tempUnit + '<extra></extra>'
        },
        {
            x: dates, y: actualMaxByDay,
            type: 'scatter', mode: 'lines',
            name: `${sYear} Daily Max Temp`,
            line: { color: '#8b0000', width: 1.6 },
            yaxis: 'y2',
            connectgaps: true,
            hovertemplate: '%{x}<br>' + sYear + ' Max: %{y:.1f}' + tempUnit + '<extra></extra>'
        },
        {
            x: dates, y: actualMinByDay,
            type: 'scatter', mode: 'lines',
            name: `${sYear} Daily Min Temp`,
            line: { color: '#1a237e', width: 1.6 },
            yaxis: 'y2',
            connectgaps: true,
            hovertemplate: '%{x}<br>' + sYear + ' Min: %{y:.1f}' + tempUnit + '<extra></extra>'
        }
    ];

    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: isDark ? '#e0e0e0' : '#636e72', family: 'Inter, sans-serif', size: 11 },
        title: {
            text: `<b>Daily Climate Normals vs ${sYear}</b><br>${lastStation.name}, ${lastStation.state} (${rangeText})`,
            x: 0.5, xanchor: 'center'
        },
        xaxis: {
            gridcolor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
            tickformat: '%b',
            dtick: 'M1'
        },
        yaxis: {
            title: precipUnit,
            side: 'right',
            rangemode: 'nonnegative',
            gridcolor: 'transparent',
            zeroline: false,
            showgrid: false,
            automargin: true
        },
        yaxis2: {
            title: tempUnit,
            overlaying: 'y',
            side: 'left',
            zeroline: false,
            gridcolor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
            automargin: true
        },
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.22 },
        margin: { t: 70, b: 90, l: 60, r: 60 },
        bargap: 0
    };

    Plotly.react('dailyClimatoDiv', traces, layout, { displayModeBar: false, responsive: true });
    // Force resize after layout settles to fix half-render on first load
    requestAnimationFrame(() => Plotly.Plots.resize('dailyClimatoDiv'));
  }

});
