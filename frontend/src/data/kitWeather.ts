import { kitNumber, kitRecord } from "./kitRuntime";

export const KIT_WEATHER_TYPE = "widget.basic.weather-v2";
export const kitWeatherConditions = [
  "晴", "多云", "阴", "阵雨", "雷阵雨", "冰雹", "雨夹雪", "小雨", "中雨", "大雨", "暴雨", "大暴雨",
  "特大暴雨", "小雨-中雨", "中雨-大雨", "大雨-暴雨", "阵雪", "小雪", "中雪", "大雪", "暴雪", "雾",
  "冻雨", "扬沙", "浮尘", "沙尘暴", "霾", "微风", "大风", "风暴", "热带风暴",
] as const;

export interface KitWeatherSample {
  condition: string;
  temperature: string;
  high?: string;
  wind: string;
  power: string;
}

interface WeatherRequest {
  id: string;
  keys: string[];
  city: string;
  extension: "base" | "all";
}

interface WeatherData {
  live?: KitWeatherSample;
  casts?: Map<string, KitWeatherSample>;
}

interface WeatherFeed {
  request: WeatherRequest;
  controller: AbortController;
  data?: WeatherData;
  timer?: ReturnType<typeof setTimeout>;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const AMAP_WEATHER_URL = "https://restapi.amap.com/v3/weather/weatherInfo";

export function kitWeatherCity(value: unknown): string {
  const code = String(value ?? "");
  return /^[1-9][0-9]{5}$/.test(code) ? code : "";
}

function weatherRequest(options: Record<string, unknown>, day: number): WeatherRequest | undefined {
  const raw = options["map-key"];
  const keys = [...new Set((Array.isArray(raw) ? raw : [raw]).flatMap(key =>
    typeof key === "string" && key.trim() && key.trim().length <= 128 ? [key.trim()] : []))];
  const city = kitWeatherCity(options["data-city"]);
  if (!city || !keys.length) return;
  const extension = day === 999 ? "base" : "all";
  return { id: JSON.stringify([city, extension, keys]), city, extension, keys };
}

function weatherText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
}

function temperature(value: unknown): string {
  const text = typeof value === "number" ? String(value) : weatherText(value);
  return /^-?\d{1,3}(?:\.\d{1,2})?$/.test(text) ? text : "";
}

function readWeather(value: unknown, extension: WeatherRequest["extension"]): WeatherData | undefined {
  const result = kitRecord(value);
  if (String(result.status) !== "1") return;
  if (extension === "base") {
    const item = kitRecord(Array.isArray(result.lives) ? result.lives[0] : undefined);
    const condition = weatherText(item.weather), degrees = temperature(item.temperature);
    if (!condition || !degrees) return;
    return { live: { condition, temperature: degrees, wind: weatherText(item.winddirection),
      power: weatherText(item.windpower) } };
  }
  const forecast = kitRecord(Array.isArray(result.forecasts) ? result.forecasts[0] : undefined);
  const casts = new Map<string, KitWeatherSample>();
  for (const entry of Array.isArray(forecast.casts) ? forecast.casts.slice(0, 4) : []) {
    const item = kitRecord(entry);
    const date = weatherText(item.date), condition = weatherText(item.dayweather);
    const low = temperature(item.nighttemp), high = temperature(item.daytemp);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && condition && low && high)
      casts.set(date, { condition, temperature: low, high, wind: weatherText(item.daywind),
        power: weatherText(item.daypower) });
  }
  return casts.size ? { casts } : undefined;
}

export function kitWeatherConditionKey(description: string): string {
  if (kitWeatherConditions.some(condition => condition === description)) return description;
  if (description.includes("雷")) return "雷阵雨";
  if (description.includes("冰雹")) return "冰雹";
  if (description.includes("雨夹雪")) return "雨夹雪";
  if (description.includes("雪")) return "小雪";
  if (description.includes("雨")) return "小雨";
  if (description.includes("霾")) return "霾";
  if (description.includes("雾")) return "雾";
  if (description.includes("沙")) return "扬沙";
  if (description.includes("风")) return "大风";
  if (description.includes("阴")) return "阴";
  if (description.includes("云")) return "多云";
  if (description.includes("晴")) return "晴";
  return "";
}

export function kitWeatherIconKey(value: unknown, condition: string): string {
  const list = kitRecord(value);
  const indexes = Array.isArray(list.indexes) ? list.indexes.map(String) : [];
  const named = indexes.find(index => kitRecord(list[index]).weather === condition);
  if (named) return named;
  const position = kitWeatherConditions.findIndex(name => name === condition);
  const original = position >= 0 ? indexes[position] : undefined;
  return original?.startsWith("idx-") && !kitRecord(list[original]).weather ? original : condition;
}

/** Keeps one request per visible city, service mode and set of keys. */
export class KitWeatherService {
  private readonly feeds = new Map<string, WeatherFeed>();

  constructor(private readonly onChange: () => void,
    private readonly fetchWeather: typeof fetch = (input, init) => fetch(input, init)) {}

  frame() {
    const requests = new Map<string, WeatherRequest>();
    return {
      sample: (options: Record<string, unknown>): KitWeatherSample | undefined => {
        const day = kitNumber(options["weather-day"], 0);
        const request = weatherRequest(options, day);
        if (!request) return;
        requests.set(request.id, request);
        const data = this.feeds.get(request.id)?.data;
        if (day === 999) return data?.live;
        const date = new Date(Date.now() + 8 * 60 * MINUTE_MS + Math.min(2, Math.max(0, day)) * DAY_MS);
        return data?.casts?.get(date.toISOString().slice(0, 10));
      },
      sync: () => {
        for (const [id, feed] of this.feeds) if (!requests.has(id)) {
          feed.controller.abort();
          clearTimeout(feed.timer);
          this.feeds.delete(id);
        }
        for (const request of requests.values()) if (!this.feeds.has(request.id)) {
          const feed = { request, controller: new AbortController() };
          this.feeds.set(request.id, feed);
          void this.refresh(feed);
        }
      },
    };
  }

  private async refresh(feed: WeatherFeed) {
    const { request, controller } = feed;
    let data: WeatherData | undefined;
    for (const key of request.keys) {
      if (controller.signal.aborted) return;
      const url = new URL(AMAP_WEATHER_URL);
      url.search = new URLSearchParams({ key, city: request.city, extensions: request.extension }).toString();
      try {
        const response = await this.fetchWeather(url, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
          credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store",
        });
        if (response.ok) data = readWeather(await response.json(), request.extension);
        if (data) break;
      } catch {
        if (controller.signal.aborted) return;
      }
    }
    if (controller.signal.aborted) return;
    const changed = !!(data || feed.data);
    feed.data = data;
    feed.timer = setTimeout(() => void this.refresh(feed),
      (data ? request.extension === "base" ? 10 : 30 : 2) * MINUTE_MS);
    if (changed) this.onChange();
  }

  dispose() { this.frame().sync(); }
}
