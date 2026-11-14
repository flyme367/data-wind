import { useEffect, useLayoutEffect, useState } from "react";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import WorkspacePage from "./pages/WorkspacePage";
import { type Route, setState } from "./state/store";

export interface AppRoute {
  page: Route;
  projectId: string | null;
}

/** 解析 hash 路由：#/login | #/ (项目工作台) | #/project/layer?projectId=xxx (编辑器) */
export function parseHash(): AppRoute {
  const h = window.location.hash;
  if (h.startsWith("#/login")) return { page: "login", projectId: null };
  const m = h.match(/^#\/project\/layer\?(.*)$/);
  if (m) {
    const q = new URLSearchParams(m[1]);
    return { page: "workspace", projectId: q.get("projectId") };
  }
  return { page: "home", projectId: null };
}

export default function App() {
  const [route, setRouteState] = useState<AppRoute>(() => parseHash());

  useLayoutEffect(() => {
    document.body.setAttribute("theme-mode", route.page === "login" ? "light" : "dark");
    document.title = route.page === "home" ? "xx可视化 · 工作台" : "xx可视化";
    setState({ route: route.page });
  }, [route.page]);

  useEffect(() => {
    const onHash = () => {
      const r = parseHash();
      setRouteState(r);
      setState({ route: r.page });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route.page === "login") return <LoginPage />;
  if (route.page === "workspace") {
    // 无 projectId 时回项目工作台（与原站路由行为一致）
    return route.projectId ? (
      <WorkspacePage key={route.projectId} projectId={route.projectId} />
    ) : (
      <HomePage />
    );
  }
  return <HomePage />;
}
