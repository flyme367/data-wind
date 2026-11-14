import { useState } from "react";
import { Button, Checkbox, Input, Toast } from "@douyinfe/semi-ui";
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
        <Input autoFocus size="large" placeholder="请输入手机号" value={phone} maxLength={11}
          onChange={(value) => setPhone(value.replace(/\D/g, ""))} onEnterPress={login} />
        <Input size="large" placeholder="请输入验证码" value={code} maxLength={6}
          onChange={(value) => setCode(value.replace(/\D/g, ""))} onEnterPress={login}
          suffix={<button className="verification-button" onClick={() => {
            if (!/^1\d{10}$/.test(phone)) { Toast.warning("请输入正确的手机号"); return; }
            setSent(true); Toast.info("本地体验验证码：123456");
          }}>{sent ? "体验码 123456" : "获取验证码"}</button>} />
        <Button size="large" theme="solid" onClick={login}>登录/注册</Button>
        <Checkbox checked={agreed} onChange={(event) => setAgreed(Boolean(event.target.checked))}>
          我已阅读并同意 《隐私保护政策》 和 《在线服务协议》
        </Checkbox>
      </div>
      <div className="login-local-note">本地界面复刻 · 验证码 123456 · <a href="#/">直接进入工作台</a></div>
    </div></main>
  </div>;
}
