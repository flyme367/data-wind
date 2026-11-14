import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Toast } from "@/lib/toast";
import BrandLogo from "../components/BrandLogo";

export default function LoginPage() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [sent, setSent] = useState(false);
  const login = () => {
    if (!/^1\d{10}$/.test(phone)) { Toast.warning("请输入正确的手机号"); return; }
    if (code !== "123456") { Toast.warning("本地体验验证码为 123456"); return; }
    if (!agreed) { Toast.warning("请先阅读并同意相关协议"); return; }
    sessionStorage.setItem("dw_demo_session", "1");
    window.location.hash = "#/";
  };
  return <div className="login-page">
    <aside className="login-art"><span className="login-brand"><BrandLogo size={26} variant="light" /></span></aside>
    <main className="login-main"><div className="login-form">
      <h1>短信登录</h1><p>未注册用户登录时将自动创建计蒙账号</p>
      <div className="login-fields">
        <Input autoFocus className="h-12" placeholder="请输入手机号" value={phone} maxLength={11}
          onChange={(event) => setPhone(event.target.value.replace(/\D/g, ""))}
          onKeyDown={(event) => event.key === "Enter" && login()} />
        <div className="relative">
          <Input className="h-12 pr-40" placeholder="请输入验证码" value={code} maxLength={6}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            onKeyDown={(event) => event.key === "Enter" && login()} />
          <button className="verification-button absolute top-0 right-0 h-full" onClick={() => {
            if (!/^1\d{10}$/.test(phone)) { Toast.warning("请输入正确的手机号"); return; }
            setSent(true); Toast.info("本地体验验证码：123456");
          }}>{sent ? "体验码 123456" : "获取验证码"}</button>
        </div>
        <Button size="lg" className="h-12" onClick={login}>登录/注册</Button>
        <label className="-mt-4 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Checkbox checked={agreed} onCheckedChange={(checked) => setAgreed(checked === true)} />
          我已阅读并同意 《隐私保护政策》 和 《在线服务协议》
        </label>
      </div>
      <div className="login-local-note">本地界面复刻 · 验证码 123456 · <a href="#/">直接进入工作台</a></div>
    </div></main>
  </div>;
}
