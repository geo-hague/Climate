document.addEventListener('DOMContentLoaded', function() {
  let lastStation = null, fullDataset = null, allStations = [], currentRange = { start: 1991, end: 2020 };
  let dailyReferenceValues = { tmin: [], tmax: [] }; 
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
        },
        error: function() {
          document.getElementById('stationHeader').innerHTML = 
              `<span style="color:var(--max-color)">Error: Data not found for station ${lastStation.station}.</span>`;
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
      processAndPlot(); 
  });

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

  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      currentRange.start = parseInt(this.dataset.start);
      currentRange.end = parseInt(this.dataset.end);
      processAndPlot();
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

  function updateDepartureBadge(id, current, normal, referenceValues) {
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

      const fullText = `${diffNum > 0 ? '+' : ''}${diffStr}° from daily average (${classification})`;

      if (diffNum > 0.05) {
          el.style.color = "var(--max-color)";
          el.textContent = fullText;
      } else if (diffNum < -0.05) {
          el.style.color = "var(--min-color)";
          el.textContent = fullText;
      } else {
          el.style.color = "var(--sub-text)";
          el.textContent = `Exactly at daily average (Normal)`;
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

    // PRECIPITATION TOTALS
    const precipUnit = isF ? "in" : "mm";
    const convertPrecip = (v) => {
        if (v == null) return 0;
        const mm = v / 10;
        return isF ? parseFloat((mm * 0.0393701).toFixed(2)) : parseFloat(mm.toFixed(1));
    };

    const monthPrecipTotal = fullDataset
        .filter(d => { const p = d.DATE.split('-'); return parseInt(p[0]) === sYear && parseInt(p[1]) === mIdx; })
        .reduce((sum, d) => sum + convertPrecip(d.PRCP), 0);

    const yearPrecipTotal = fullDataset
        .filter(d => parseInt(d.DATE.split('-')[0]) === sYear)
        .reduce((sum, d) => sum + convertPrecip(d.PRCP), 0);

    const yearLabel = sYear === systemYear ? 'Year-to-Date' : 'Annual';

// 4. CURRENT 2026 MONTH CARDS (Only show if 2026 is selected)
    const currentSystemMonth = todayDate.getMonth() + 1; 
    const minCard2026 = document.getElementById('currMonthMin').parentElement;
    const maxCard2026 = document.getElementById('currMonthMax').parentElement;

    // First check: Is the user actually looking at the current year (2026)?
    if (sYear === systemYear && mIdx <= currentSystemMonth) {
        minCard2026.style.display = 'block';
        maxCard2026.style.display = 'block';
        
        const currYearData = rawMonthData.filter(d => d.year === systemYear);
        const validDays = currYearData.filter(d => d.tmin !== null || d.tmax !== null).map(d => d.day);
        let latestDateLabel = validDays.length > 0 ? `<br><span style="font-size:0.65rem; color:var(--sub-text); font-weight:400;">Latest Data: ${monthName} ${Math.max(...validDays)}, ${systemYear}</span>` : "";
        
        document.getElementById('currMonthMinLabel').innerHTML = `${monthName} ${systemYear} Average Minimum Temperature ${latestDateLabel}`;
        document.getElementById('currMonthMaxLabel').innerHTML = `${monthName} ${systemYear} Average Maximum Temperature ${latestDateLabel}`;
        document.getElementById('currMonthMin').textContent = getAvg(currYearData.map(r => convert(r.tmin)).filter(v => v !== null)) + unit;
        document.getElementById('currMonthMax').textContent = getAvg(currYearData.map(r => convert(r.tmax)).filter(v => v !== null)) + unit;
    } else {
        // Hide them if we are looking at the past or the future
        minCard2026.style.display = 'none';
        maxCard2026.style.display = 'none';
    }

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
            name:'Min', 
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
            name:'Max', 
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
    // 6. NEW CONTEXT WINDOW (±15 Days)
    const selectedDate = new Date(sYear, mIdx - 1, dReq);
    
    // Check if we are looking at the current year (2026) and today's date
    const isCurrentEnd = (sYear === 2026 && mIdx === 1 && dReq === 31);

    const yearSlice = fullDataset.filter(d => {
        const p = d.DATE.split('-');
        const dDate = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
        
        if (isCurrentEnd) {
            // If it's today, show the last 30 days so the chart is full
            return parseInt(p[0]) === 2026 && (selectedDate - dDate) / 86400000 <= 30 && (selectedDate - dDate) >= 0;
        } else {
            // Otherwise, use your original ±15 day window
            return parseInt(p[0]) === sYear && Math.abs(dDate - selectedDate) / 86400000 <= 15;
        }
    });

    // Re-sync the labels and historical averages
    const windowLabels = yearSlice.map(d => d.DATE.split('-').slice(1).join('/'));
    const historicalAverages = windowLabels.map(label => {
        const [m, d] = label.split('/').map(Number);
        const matches = fullDataset.filter(row => {
            const p = row.DATE.toString().split('-');
            return parseInt(p[1]) === m && parseInt(p[2]) === d && 
                   parseInt(p[0]) >= (currentRange.start === 0 ? 1900 : currentRange.start) && 
                   parseInt(p[0]) <= (currentRange.end >= 9000 ? 2025 : currentRange.end);
        });

        // Convert raw values for the SD calculation
        const tmaxVals = matches.map(r => convert(r.TMAX/10)).filter(v => v !== null);
        const tminVals = matches.map(r => convert(r.TMIN/10)).filter(v => v !== null);

        return {
            avgMax: tmaxVals.length ? (tmaxVals.reduce((a, b) => a + b, 0) / tmaxVals.length) : null,
            avgMin: tminVals.length ? (tminVals.reduce((a, b) => a + b, 0) / tminVals.length) : null,
            stdMax: getStdDev(tmaxVals), // Using your helper
            stdMin: getStdDev(tminVals)  // Using your helper
        };
    });

    // --- 7. UPDATED GATEKEEPER: LIVE OR HISTORICAL OBSERVATION ---
    const todayBtn = document.getElementById('todayBtn');
    const isToday = (mIdx === (todayDate.getMonth() + 1)) && (dReq === todayDate.getDate()) && (sYear === systemYear);

    if (isToday) {
        todayBtn.classList.add('is-today');
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
    renderWindowCharts(yearSlice, historicalAverages, sYear, windowLabels, rangeText, monthPrecipTotal, yearPrecipTotal, monthName, yearLabel);
}

function renderWindowCharts(yearSlice, histAverages, sYear, labels, rangeText, monthPrecipTotal, yearPrecipTotal, monthName, yearLabel) {
    const isF = document.getElementById('unitToggle').checked;
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const tempUnit = isF ? "°F" : "°C";
    const precipUnit = isF ? "in" : "mm";

    const convertTemp = (v) => (v === null ? null : (isF ? (v * 9/5 + 32) : v));
    const convertPrecip = (v) => {
        if (v == null) return 0;
        const mm = v / 10;
        return isF ? parseFloat((mm * 0.0393701).toFixed(2)) : parseFloat(mm.toFixed(1));
    };

    // Ribbon Math (using histAverages to match parameter name)
    const xDouble = labels.concat([...labels].reverse());
    const maxRibbonY = histAverages.map(h => h.avgMax + h.stdMax)
        .concat([...histAverages].reverse().map(h => h.avgMax - h.stdMax));
    const minRibbonY = histAverages.map(h => h.avgMin + h.stdMin)
        .concat([...histAverages].reverse().map(h => h.avgMin - h.stdMin));

    const tempTraces = [
        // LAYER 1: Ribbons (Background)
        {
            x: xDouble, y: maxRibbonY, fill: 'toself',
            fillcolor: 'rgba(255, 118, 117, 0.1)', line: {color: 'transparent'},
            name: 'Normal Range (Max)', showlegend: false, hoverinfo: 'skip'
        },
        {
            x: xDouble, y: minRibbonY, fill: 'toself',
            fillcolor: 'rgba(116, 185, 255, 0.1)', line: {color: 'transparent'},
            name: 'Normal Range (Min)', showlegend: false, hoverinfo: 'skip'
        },
        // LAYER 2: Your Original Data Traces (Foreground)
        { 
            x: labels, y: yearSlice.map(d => convertTemp(d.TMAX/10)), 
            text: yearSlice.map((d, i) => getSigmaClassification(convertTemp(d.TMAX/10), histAverages[i].avgMax, dailyReferenceValues.tmax)),
            name: `${sYear} Maximum Temperature`, mode: 'lines+markers', 
            line: {color: '#ff7675', width: 3}, marker: {size: 6},
            hovertemplate: 'Date: %{x}/' + sYear + '<br>Temp: %{y:.1f}' + tempUnit + '<br><b>%{text}</b><extra></extra>'
        },
        { 
            x: labels, y: yearSlice.map(d => convertTemp(d.TMIN/10)), 
            text: yearSlice.map((d, i) => getSigmaClassification(convertTemp(d.TMIN/10), histAverages[i].avgMin, dailyReferenceValues.tmin)),
            name: `${sYear} Minimum Temperature`, mode: 'lines+markers', 
            line: {color: '#74b9ff', width: 3}, marker: {size: 6},
            hovertemplate: 'Date: %{x}/' + sYear + '<br>Temp: %{y:.1f}' + tempUnit + '<br><b>%{text}</b><extra></extra>'
        },
        { 
            x: labels, y: histAverages.map(h => h.avgMax), 
            name: `Normal Maximum Temperature`, mode: 'lines', 
            line: {color: '#ff7675', dash: 'dot', width: 1.5},
            hovertemplate: 'Normal Maximum Temperature<br>Date: %{x}<br>Temp: %{y:.1f}' + tempUnit + '<extra></extra>'
        },
        { 
            x: labels, y: histAverages.map(h => h.avgMin), 
            name: `Normal Minimum Temperature`, mode: 'lines', 
            line: {color: '#74b9ff', dash: 'dot', width: 1.5},
            hovertemplate: 'Normal Minimum Temperature<br>Date: %{x}<br>Temp: %{y:.1f}' + tempUnit + '<extra></extra>'
        }
    ];

    const baseLayout = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: isDark ? "#e0e0e0" : "#636e72", family: 'Inter, sans-serif', size: 11 },
        xaxis: { 
            tickangle: -45, 
            gridcolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
            automargin: true 
        },
        margin: { t: 60, b: 80, l: 50, r: 20 },
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.4 },
        hovermode: 'closest'
    };

    Plotly.react('windowTempDiv', tempTraces, { 
        ...baseLayout, 
        title: {
            text: `<b>${sYear} Temperature vs ${rangeText} Normals</b><br>${lastStation.name}, ${lastStation.state}`,
            x: 0.5,
            xanchor: 'center'
        },
        yaxis: { 
            title: tempUnit, 
            gridcolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' 
        }
    });

    const totalPrecip = yearSlice.reduce((sum, d) => sum + convertPrecip(d.PRCP), 0).toFixed(2);

    const yValuesWithGaps = yearSlice.map(d => {
        const val = convertPrecip(d.PRCP);
        return val > 0 ? val : null; 
    });

    const precipTrace = {
        x: labels,
        y: yValuesWithGaps, 
        type: 'bar', 
        marker: { 
            color: '#0984e3', 
            opacity: 0.7, 
            line: { width: 0 }
        }, 
        name: 'Daily Precip',
        hovertemplate: `Date: %{x}<br>Amount: %{y} ${precipUnit}<extra></extra>`
    };

    Plotly.react('windowPrecipDiv', [precipTrace], { 
        ...baseLayout, 
        title: {
            text: `<b>${sYear} Precipitation</b><br>` +
                  `Window: ${totalPrecip} ${precipUnit}  ·  ${monthName} Total: ${monthPrecipTotal.toFixed(isF ? 2 : 1)} ${precipUnit}  ·  ${yearLabel}: ${yearPrecipTotal.toFixed(isF ? 2 : 1)} ${precipUnit}<br>` +
                  `${lastStation.name}, ${lastStation.state}`,
            x: 0.5,
            xanchor: 'center'
        },
        xaxis: {
            ...baseLayout.xaxis,
            type: 'category',
            tickvals: labels
        },
        yaxis: { 
            title: precipUnit, 
            gridcolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
            rangemode: 'nonnegative',
            zeroline: false,
            fixedrange: false
        }
    });

    Plotly.Plots.resize('windowTempDiv');
    Plotly.Plots.resize('windowPrecipDiv');
}
  
  window.addEventListener('resize', () => { 
      const charts = ['boxDiv', 'lineDiv', 'windowTempDiv', 'windowPrecipDiv'];
      charts.forEach(id => {
          const el = document.getElementById(id);
          if (el) Plotly.Plots.resize(el);
      });
  });
});
