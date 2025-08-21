import { useEffect, useMemo, useRef, useState } from "react";

/** ---------- Types ---------- */
interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
}
interface ForecastCurrent {
  time: string;
  temperature_2m: number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
}
interface ForecastHourly {
  time: string[];
  temperature_2m: number[];
  precipitation_probability: number[];
}
interface ForecastDaily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_probability_max: number[];
}
interface ForecastResponse {
  current: ForecastCurrent;
  hourly: ForecastHourly;
  daily: ForecastDaily;
}
interface AirHourly {
  time: string[];
  us_aqi?: number[];
  pm10?: number[];
  pm2_5?: number[];
}
interface AirResponse {
  hourly?: AirHourly;
}

/** ---------- Helpers ---------- */
const DEFAULT_CITIES: GeoResult[] = [
  { name: "Kathmandu", latitude: 27.7172, longitude: 85.324 },
  { name: "Pokhara", latitude: 28.2096, longitude: 83.9856 },
  { name: "Lalitpur", latitude: 27.6644, longitude: 85.3188 },
  { name: "Biratnagar", latitude: 26.455, longitude: 87.2705 },
];

function aqiLabel(aqi?: number) {
  if (aqi == null) return { text: "—", cls: "aqi aqi-na" };
  if (aqi <= 50) return { text: `Good (${aqi})`, cls: "aqi aqi-good" };
  if (aqi <= 100) return { text: `Moderate (${aqi})`, cls: "aqi aqi-mod" };
  if (aqi <= 150) return { text: `USG (${aqi})`, cls: "aqi aqi-usg" };
  if (aqi <= 200) return { text: `Unhealthy (${aqi})`, cls: "aqi aqi-unh" };
  if (aqi <= 300) return { text: `Very Unhealthy (${aqi})`, cls: "aqi aqi-vunh" };
  return { text: `Hazardous (${aqi})`, cls: "aqi aqi-haz" };
}

/** localStorage state hook */
function useLocal<T>(key: string, initial: T) {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  }, [key, val]);
  return [val, setVal] as const;
}

/** ---------- App ---------- */
type CurrentCity = {
  name: string;
  lat: number;
  lon: number;
  weather: ForecastResponse;
  air?: AirResponse;
  aqi?: number | null;
};

export default function App() {
  const [query, setQuery] = useState<string>("");
  const [sugs, setSugs] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");
  const [city, setCity] = useState<CurrentCity | null>(null);
  const [fav, setFav] = useLocal<GeoResult[]>("wx:fav", [DEFAULT_CITIES[0]]);
  const abortRef = useRef<AbortController | null>(null);

  const pageTitle = useMemo(
    () => (city ? `${city.name} – Panigham Weather` : "Panigham – Weather & AQI"),
    [city]
  );
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

  /** ---- Search suggestions ---- */
  useEffect(() => {
    if (query.trim().length < 2) {
      setSugs([]);
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      query
    )}&count=6&language=en&format=json`;
    fetch(url, { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        const list: GeoResult[] = (j.results || []).map((x: any) => ({
          name: x.name as string,
          latitude: Number(x.latitude),
          longitude: Number(x.longitude),
        }));
        const localMatch = DEFAULT_CITIES.filter((c) =>
          c.name.toLowerCase().includes(query.toLowerCase())
        );
        const seen = new Set<string>();
        const merged = [...localMatch, ...list].filter((c) => {
          const k = c.name.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        setSugs(merged.slice(0, 8));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [query]);

  /** ---- Load by coordinates ---- */
  async function load(lat: number, lon: number, name: string) {
    setErr("");
    setLoading(true);
    try {
      const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m&hourly=temperature_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
      const w: ForecastResponse = await fetch(wUrl).then((r) => r.json());

      const aUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=us_aqi,pm10,pm2_5&timezone=auto`;
      const a: AirResponse = await fetch(aUrl).then((r) => r.json());

      let aqi: number | null = null;
      if (a?.hourly?.time && w?.current?.time && a.hourly.us_aqi) {
        const idx = a.hourly.time.indexOf(w.current.time);
        if (idx >= 0) aqi = a.hourly.us_aqi[idx] ?? null;
      }

      setCity({ name, lat, lon, weather: w, air: a, aqi });
    } catch {
      setErr("Could not fetch data. Check your internet connection.");
    } finally {
      setLoading(false);
    }
  }

  function pick(g: GeoResult) {
    setQuery("");
    setSugs([]);
    load(g.latitude, g.longitude, g.name);
  }

  function addFav() {
    if (!city) return;
    if (fav.some((f) => f.name.toLowerCase() === city.name.toLowerCase())) return;
    setFav([{ name: city.name, latitude: city.lat, longitude: city.lon }, ...fav].slice(0, 12));
  }

  function removeFav(name: string) {
    setFav(fav.filter((f) => f.name !== name));
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setErr("Geolocation not available in this browser.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => load(pos.coords.latitude, pos.coords.longitude, "My Location"),
      () => {
        setLoading(false);
        setErr("Location permission denied.");
      },
      { timeout: 10000 }
    );
  }

  /** ---- UI ---- */
  const AQIChip = ({ value }: { value?: number | null }) => {
    const { text, cls } = aqiLabel(value ?? undefined);
    return <span className={`chip ${cls}`}>{text}</span>;
  };

  return (
    <div className="wrap bg-gradient">
      <header className="top">
        <div>
          <h1>🌤 Panigham</h1>
          <p className="muted">Your trusted weather & air quality companion</p>
        </div>
        <div className="actions">
          <button onClick={useMyLocation}>📍 Use my location</button>
        </div>
      </header>

      {/* Search */}
      <div className="search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 Search city (e.g., Kathmandu, Pokhara)"
        />
        {!!sugs.length && (
          <div className="dropdown">
            {sugs.map((s) => (
              <button key={`${s.name}-${s.latitude}`} onClick={() => pick(s)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Favorites */}
      <div className="fav">
        {fav.map((f) => (
          <div key={f.name} className="pill">
            <button className="link" onClick={() => load(f.latitude, f.longitude, f.name)}>
              {f.name}
            </button>
            <button className="x" onClick={() => removeFav(f.name)}>
              ×
            </button>
          </div>
        ))}
      </div>

      {err && <div className="error">{err}</div>}
      {loading && <div className="loading">Loading…</div>}

      {/* Current + Hourly + Daily */}
      {city && !loading && (
        <div className="grid">
          {/* Current */}
          <div className="card">
            <div className="row">
              <div>
                <div className="muted small">Now in</div>
                <div className="title">{city.name}</div>
              </div>
              <button onClick={addFav}>＋ Favorite</button>
            </div>
            <div className="temp big">
              {Math.round(city.weather.current.temperature_2m)}°C
            </div>
            <div className="muted">
              Feels {Math.round(city.weather.current.apparent_temperature)}°C · 💧{" "}
              {city.weather.current.relative_humidity_2m}% · 💨{" "}
              {city.weather.current.wind_speed_10m} m/s
            </div>
            <div className="aqi">
              🌱 Air Quality: <AQIChip value={city.aqi} />
            </div>
          </div>

          {/* Hourly */}
          <div className="card">
            <div className="row">
              <div className="title-sm">Today (Hourly)</div>
              <div className="muted small">Local time: {new Date().toLocaleString()}</div>
            </div>
          <div className="hours">
            {(() => {
              // Find index of the current hour
              const now = new Date();
              const currentHourIndex = city.weather.hourly.time.findIndex((t: string) => {
                return new Date(t).getHours() === now.getHours();
              });

              // Slice next 6 hours starting from current index
              const nextHours = city.weather.hourly.time.slice(currentHourIndex, currentHourIndex + 6);

              return nextHours.map((t: string, i: number) => {
                const localTime = new Date(t).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                });

                return (
                  <div className="hour" key={t}>
                    <div className="muted small">{localTime}</div>
                    <div className="h-temp">
                      {Math.round(city.weather.hourly.temperature_2m[currentHourIndex + i])}°
                    </div>
                    <div className="muted small">
                      🌧 {city.weather.hourly.precipitation_probability[currentHourIndex + i] ?? 0}%
                    </div>
                  </div>
                );
              });
            })()}
          </div>
           
        
        </div>

          {/* Daily */}
          <div className="card">
            <div className="title-sm">Next 7 Days</div>
            <div className="days">
              {city.weather.daily.time.slice(0, 7).map((t, i) => (
                <div className="day" key={t}>
                  <div className="muted small">
                    {new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  </div>
                  <div>
                    🌡 {Math.round(city.weather.daily.temperature_2m_min[i])}° /{" "}
                    {Math.round(city.weather.daily.temperature_2m_max[i])}°
                  </div>
                  <div className="muted small">
                    🌧 {city.weather.daily.precipitation_probability_max[i] ?? 0}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer className="foot">
        <div>© {new Date().getFullYear()} Panigham</div>
        <div className="muted small">NEPAL · MIT Licensed</div>
      </footer>
    </div>
  );
}
