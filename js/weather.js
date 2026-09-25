/*
** Weather overlay: rain or snow that leans with the wind, from the current weather at the stop (Open-Meteo).
**
** Dev tool (localhost only): press w for a panel to force rain/snow, intensity, wind speed and direction.
** Also available from the console: setWeatherOverride({ mode: 'snow', intensity: 0.8, windSpeed: 30, windDirection: 270 })
** and setWeatherOverride(null) to go back to the live weather.
*/
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=51.5866&longitude=4.776'
  + '&current=weather_code,is_day,rain,precipitation,showers,snowfall,wind_speed_10m,wind_direction_10m'
  + '&timezone=Europe%2FBerlin&forecast_days=1';

const WEATHER_RESOLUTION_SCALE = 0.5; // the overlay canvas is this fraction of the screen
const WEATHER_MAX_FPS = 30;
const MAX_RAIN_DROPS = 450;
const MAX_SNOWFLAKES = 260;

// Intensity (0-1) implied by the WMO weather code, for when the measured amounts are still 0
const rainCodeIntensity = { 51: 0.15, 53: 0.25, 55: 0.35, 56: 0.2, 57: 0.35, 61: 0.3, 63: 0.6, 65: 1, 66: 0.4, 67: 0.9, 80: 0.4, 81: 0.7, 82: 1, 95: 0.8, 96: 1, 99: 1 };
const snowCodeIntensity = { 71: 0.3, 73: 0.6, 75: 1, 77: 0.3, 85: 0.5, 86: 1 };

// What's falling: mode 'rain' | 'snow' | 'none', intensity 0-1, wind speed in km/h, direction in degrees
// (the compass direction the wind comes FROM, like the API reports it)
let liveWeather = { mode: 'none', intensity: 0, windSpeed: 0, windDirection: 0 };
let weatherOverride = null;

function parseWeather(current) {
  const rainAmount = (current.rain ?? 0) + (current.showers ?? 0); // mm/h
  const snowAmount = current.snowfall ?? 0; // cm/h
  const rainIntensity = Math.max(rainCodeIntensity[current.weather_code] ?? 0, rainAmount > 0 ? Math.min(1, 0.15 + rainAmount / 5) : 0);
  const snowIntensity = Math.max(snowCodeIntensity[current.weather_code] ?? 0, snowAmount > 0 ? Math.min(1, 0.15 + snowAmount / 1.5) : 0);
  const mode = snowIntensity > rainIntensity ? 'snow' : rainIntensity > 0 ? 'rain' : 'none';

  return {
    mode,
    intensity: mode === 'snow' ? snowIntensity : mode === 'rain' ? rainIntensity : 0,
    windSpeed: current.wind_speed_10m ?? 0,
    windDirection: current.wind_direction_10m ?? 0,
  };
}

function fetchWeather() {
  fetch(WEATHER_URL)
    .then((response) => response.json())
    .then((data) => {
      if (data.current) {
        liveWeather = parseWeather(data.current);
        syncWeatherPanel();
      }
    })
    .catch(() => { }); // No weather overlay if the API fails
}

function getWeather() {
  return weatherOverride
    ? { ...liveWeather, ...weatherOverride, mode: weatherOverride.mode === 'live' ? liveWeather.mode : weatherOverride.mode }
    : liveWeather;
}

function setWeatherOverride(override) {
  weatherOverride = override;
  syncWeatherPanel();
}
window.setWeatherOverride = setWeatherOverride;

/*
** Rendering
*/
const weatherCanvas = document.createElement('canvas');
weatherCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
document.body.appendChild(weatherCanvas);
const weatherCtx = weatherCanvas.getContext('2d');

// Per particle: position, depth (0 = far, 1 = near) and a random factor for variety
const dropX = new Float32Array(MAX_RAIN_DROPS);
const dropY = new Float32Array(MAX_RAIN_DROPS);
const dropDepth = new Float32Array(MAX_RAIN_DROPS);
const flakeX = new Float32Array(MAX_SNOWFLAKES);
const flakeY = new Float32Array(MAX_SNOWFLAKES);
const flakeDepth = new Float32Array(MAX_SNOWFLAKES);
const flakePhase = new Float32Array(MAX_SNOWFLAKES);

function scatterWeatherParticles() {
  const w = weatherCanvas.width;
  const h = weatherCanvas.height;
  for (let i = 0; i < MAX_RAIN_DROPS; i++) {
    dropX[i] = Math.random() * w;
    dropY[i] = Math.random() * h;
    dropDepth[i] = Math.random();
  }
  for (let i = 0; i < MAX_SNOWFLAKES; i++) {
    flakeX[i] = Math.random() * w;
    flakeY[i] = Math.random() * h;
    flakeDepth[i] = Math.random();
    flakePhase[i] = Math.random() * Math.PI * 2;
  }
}

function resizeWeatherCanvas() {
  weatherCanvas.width = Math.max(1, Math.round(window.innerWidth * WEATHER_RESOLUTION_SCALE));
  weatherCanvas.height = Math.max(1, Math.round(window.innerHeight * WEATHER_RESOLUTION_SCALE));
  scatterWeatherParticles();
}
window.addEventListener('resize', resizeWeatherCanvas);
resizeWeatherCanvas();

// One soft white dot, drawn once and stamped for every flake
const flakeSprite = document.createElement('canvas');
flakeSprite.width = flakeSprite.height = 16;
{
  const c = flakeSprite.getContext('2d');
  const gradient = c.createRadialGradient(8, 8, 0, 8, 8, 8);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gradient;
  c.fillRect(0, 0, 16, 16);
}

// Horizontal push from the wind, -1.5 (blowing left) to 1.5 (blowing right). Wind comes FROM the direction,
// so it blows towards direction + 180: from the west (270) pushes to the east (right on a north-up screen).
function getWindPush(weather) {
  const towards = (weather.windDirection + 180) * Math.PI / 180;
  return Math.max(-1.5, Math.min(1.5, Math.sin(towards) * weather.windSpeed / 30));
}

let shownIntensity = 0; // eases towards the target so rain fades in and out instead of popping
let shownMode = 'none';
let weatherFrameId = 0;
let lastWeatherFrame = 0;

function drawRain(dt, count, push) {
  const w = weatherCanvas.width;
  const h = weatherCanvas.height;
  const ctx = weatherCtx;
  const dark = typeof currentDarkness === 'number' ? currentDarkness : 0;
  const color = `${Math.round(215 - 60 * dark)},${Math.round(230 - 55 * dark)},${Math.round(255 - 30 * dark)}`;

  for (let layer = 0; layer < 2; layer++) {
    ctx.beginPath();
    for (let i = layer; i < count; i += 2) {
      const depth = dropDepth[i];
      const fall = (380 + 420 * depth) * WEATHER_RESOLUTION_SCALE * 2; // px/s
      const slant = push * 0.45; // horizontal px per vertical px
      const length = (6 + 10 * depth) * WEATHER_RESOLUTION_SCALE * 2;

      dropY[i] += fall * dt;
      dropX[i] += fall * slant * dt;
      if (dropY[i] > h + length) {
        dropY[i] = -length * Math.random();
        dropX[i] = Math.random() * w;
      }
      if (dropX[i] > w) dropX[i] -= w;
      else if (dropX[i] < 0) dropX[i] += w;

      ctx.moveTo(dropX[i], dropY[i]);
      ctx.lineTo(dropX[i] - length * slant, dropY[i] - length);
    }
    ctx.strokeStyle = `rgba(${color},${layer ? 0.55 : 0.3})`;
    ctx.lineWidth = layer ? 1.4 : 1;
    ctx.stroke();
  }
}

function drawSnow(dt, count, push, now) {
  const w = weatherCanvas.width;
  const h = weatherCanvas.height;
  const ctx = weatherCtx;
  ctx.globalAlpha = 0.9;

  for (let i = 0; i < count; i++) {
    const depth = flakeDepth[i];
    const fall = (30 + 50 * depth) * WEATHER_RESOLUTION_SCALE * 2;
    const sway = Math.sin(now / 900 + flakePhase[i]) * 14 * WEATHER_RESOLUTION_SCALE * 2;
    const size = (3 + 6 * depth) * WEATHER_RESOLUTION_SCALE * 2;

    flakeY[i] += fall * dt;
    flakeX[i] += (sway + push * 110 * (0.5 + depth) * WEATHER_RESOLUTION_SCALE * 2) * dt;
    if (flakeY[i] > h + size) {
      flakeY[i] = -size;
      flakeX[i] = Math.random() * w;
    }
    if (flakeX[i] > w + size) flakeX[i] -= w + 2 * size;
    else if (flakeX[i] < -size) flakeX[i] += w + 2 * size;

    ctx.drawImage(flakeSprite, flakeX[i] - size / 2, flakeY[i] - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

function weatherFrame(timestamp) {
  weatherFrameId = 0;
  const weather = getWeather();
  const target = weather.mode === 'none' ? 0 : Math.max(0, Math.min(1, weather.intensity));

  // Only draw at the capped frame rate; anything in between costs nothing
  const elapsed = timestamp - lastWeatherFrame;
  if (elapsed < 1000 / WEATHER_MAX_FPS - 2) {
    weatherFrameId = requestAnimationFrame(weatherFrame);
    return;
  }
  const dt = Math.min(0.1, lastWeatherFrame ? elapsed / 1000 : 0);
  lastWeatherFrame = timestamp;

  // Ease the intensity (~2 seconds); when fading out completely, keep the old mode until it's gone
  if (weather.mode !== 'none' && weather.mode !== shownMode && shownIntensity < 0.02) {
    shownMode = weather.mode;
  }
  const goal = weather.mode === shownMode ? target : 0;
  shownIntensity += (goal - shownIntensity) * Math.min(1, dt * 1.5);
  if (Math.abs(goal - shownIntensity) < 0.005) shownIntensity = goal;

  weatherCtx.clearRect(0, 0, weatherCanvas.width, weatherCanvas.height);

  if (shownIntensity <= 0 && weather.mode === 'none') {
    return; // dry: stop looping, startWeatherLoop() wakes it up again
  }

  const push = getWindPush(weather);
  if (shownMode === 'rain') {
    drawRain(dt, Math.ceil(shownIntensity * MAX_RAIN_DROPS), push);
  } else if (shownMode === 'snow') {
    drawSnow(dt, Math.ceil(shownIntensity * MAX_SNOWFLAKES), push, timestamp);
  }

  weatherFrameId = requestAnimationFrame(weatherFrame);
}

// Checked every second: cheap, and it wakes the loop when the weather turns wet
function startWeatherLoop() {
  if (!weatherFrameId && (getWeather().mode !== 'none' || shownIntensity > 0)) {
    lastWeatherFrame = 0;
    weatherFrameId = requestAnimationFrame(weatherFrame);
  }
}
setInterval(startWeatherLoop, 1000);

fetchWeather();

/*
** Dev tool (localhost, press w)
*/
const compassNames = ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW'];
let weatherPanel = null;

function syncWeatherPanel() {
  if (!weatherPanel) {
    return;
  }
  const weather = getWeather();
  const set = (name, value) => { weatherPanel.querySelector(`[name=${name}]`).value = value; };
  set('mode', weatherOverride?.mode ?? 'live');
  set('intensity', weather.intensity);
  set('windSpeed', weather.windSpeed);
  set('windDirection', weather.windDirection);
  weatherPanel.querySelector('.readout').textContent =
    `${weather.mode}, intensiteit ${weather.intensity.toFixed(2)}, wind ${Math.round(weather.windSpeed)} km/h uit `
    + `${compassNames[Math.round(weather.windDirection / 45) % 8]} (${Math.round(weather.windDirection)}°)`;
  startWeatherLoop();
}

function buildWeatherPanel() {
  weatherPanel = document.createElement('div');
  weatherPanel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:50;background:rgba(0,0,0,.8);color:#fff;'
    + 'font:13px sans-serif;padding:12px;border-radius:8px;width:260px;display:none;';
  weatherPanel.innerHTML = `
    <b>Weer (dev)</b>
    <div class="readout" style="margin:6px 0;opacity:.8"></div>
    <label>Modus <select name="mode" style="color:#000">
      <option value="live">Live</option><option value="none">Droog</option>
      <option value="rain">Regen</option><option value="snow">Sneeuw</option></select></label>
    <label style="display:block">Intensiteit <input name="intensity" type="range" min="0" max="1" step="0.05" style="width:100%"></label>
    <label style="display:block">Windsnelheid (km/h) <input name="windSpeed" type="range" min="0" max="100" step="1" style="width:100%"></label>
    <label style="display:block">Windrichting (uit) <input name="windDirection" type="range" min="0" max="360" step="5" style="width:100%"></label>
    <button type="button" name="reset" style="color:#000;padding:2px 8px;margin-top:4px">Terug naar live</button>`;
  document.body.appendChild(weatherPanel);

  weatherPanel.addEventListener('input', (event) => {
    const value = (name) => weatherPanel.querySelector(`[name=${name}]`).value;
    if (event.target.name === 'mode' && event.target.value === 'live') {
      setWeatherOverride(null);
      return;
    }
    // Changing anything forces all four values, so it's predictable what you see
    setWeatherOverride({
      mode: value('mode'),
      intensity: parseFloat(value('intensity')),
      windSpeed: parseFloat(value('windSpeed')),
      windDirection: parseFloat(value('windDirection')),
    });
  });
  weatherPanel.querySelector('[name=reset]').addEventListener('click', () => setWeatherOverride(null));
  syncWeatherPanel();
}

if (isLocalhost()) {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'w') {
      if (!weatherPanel) {
        buildWeatherPanel();
      }
      weatherPanel.style.display = weatherPanel.style.display === 'none' ? 'block' : 'none';
    }
  });

  // ?weather=rain / ?weather=snow starts with that forced (intensity 0.7, a breeze from the west)
  const queryWeather = new URLSearchParams(window.location.search).get('weather');
  if (queryWeather) {
    weatherOverride = { mode: queryWeather, intensity: 0.7, windSpeed: 20, windDirection: 270 };
  }
}
