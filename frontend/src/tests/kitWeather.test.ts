import { afterEach, describe, expect, it, vi } from "vitest";
import { KitWeatherService, kitWeatherConditionKey, kitWeatherIconKey } from "../data/kitWeather";

const options = { "data-city": 330100, "map-key": ["test-key"], "weather-day": 0 };
const forecasts = {
  status: "1",
  forecasts: [{ casts: [
    { date: "2026-11-15", dayweather: "多云", daytemp: "18", nighttemp: "6", daywind: "北", daypower: "≤3" },
    { date: "2026-11-16", dayweather: "小雨", daytemp: "11", nighttemp: "-2", daywind: "东北", daypower: "4" },
    { date: "2026-11-17", dayweather: "晴", daytemp: "17", nighttemp: "7", daywind: "南", daypower: "3" },
  ] }],
};

afterEach(() => vi.useRealTimers());

describe("套件天气数据", () => {
  it("同城三天共享预报请求，按北京时间日期选取并在实况模式下获取单个温度", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T18:30:00Z"));
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.searchParams.get("extensions") === "all") return Response.json(forecasts);
      return Response.json({ status: "1", lives: [{
        weather: "晴", temperature: 10.5, winddirection: "东", windpower: "2",
      }] });
    });
    const change = vi.fn();
    const service = new KitWeatherService(change, fetcher);
    try {
      const setup = service.frame();
      expect(setup.sample(options)).toBeUndefined();
      setup.sample({ ...options, "weather-day": 1 });
      setup.sample({ ...options, "weather-day": 2 });
      setup.sample({ ...options, "weather-day": 999 });
      setup.sync();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("extensions")))
        .toEqual(["all", "base"]);
      expect(change).toHaveBeenCalledTimes(2);
      const frame = service.frame();
      expect(frame.sample(options)).toEqual({
        condition: "多云", temperature: "6", high: "18", wind: "北", power: "≤3",
      });
      expect(frame.sample({ ...options, "weather-day": 1 })).toMatchObject({ condition: "小雨", temperature: "-2" });
      expect(frame.sample({ ...options, "weather-day": 2 })?.condition).toBe("晴");
      expect(frame.sample({ ...options, "weather-day": 999 })).toEqual({
        condition: "晴", temperature: "10.5", wind: "东", power: "2",
      });
      frame.sync();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally { service.dispose(); }
  });

  it("跳过空 Key，回退到次选 Key，更换城市时取消请求并忽略旧结果", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T00:00:00Z"));
    let completeOld: (value: Response) => void = () => {};
    const staleStatus = new Promise<Response>(resolve => { completeOld = resolve; });
    const fetcher = vi.fn<typeof fetch>(async input => {
      const query = new URL(String(input)).searchParams;
      if (query.get("city") === "330100") return staleStatus;
      return query.get("key") === "backup" ? Response.json(forecasts)
        : Response.json({ status: "0", info: "INVALID_USER_KEY" });
    });
    const change = vi.fn();
    const service = new KitWeatherService(change, fetcher);
    const next = { ...options, "data-city": 320100, "map-key": ["", "bad", " backup "] };
    try {
      const initial = service.frame();
      initial.sample({ ...options, "map-key": [""] });
      initial.sample({ ...options, "data-city": "missing" });
      initial.sync();
      expect(fetcher).not.toHaveBeenCalled();
      const old = service.frame();
      old.sample(options);
      old.sync();
      const replacement = service.frame();
      replacement.sample(next);
      replacement.sync();
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      completeOld(Response.json(forecasts));
      await vi.advanceTimersByTimeAsync(0);
      expect(change).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("key")))
        .toEqual(["test-key", "bad", "backup"]);
      expect(service.frame().sample(options)).toBeUndefined();
      expect(service.frame().sample(next)?.condition).toBe("多云");
    } finally { service.dispose(); }
  });

  it("按天气名称匹配自定义图标，保留原始列表的顺序关联", () => {
    expect(kitWeatherConditionKey("中雨-大雨")).toBe("中雨-大雨");
    expect(kitWeatherConditionKey("强雷阵雨")).toBe("雷阵雨");
    expect(kitWeatherIconKey({ indexes: ["idx-original"] }, "晴")).toBe("idx-original");
    const updated = { indexes: ["小雨"], 小雨: { weather: "小雨", "change-image": "./rain.png" } };
    expect(kitWeatherIconKey(updated, "晴")).toBe("晴");
    expect(kitWeatherIconKey(updated, "小雨")).toBe("小雨");
  });
});
