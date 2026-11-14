import { useId, type ReactNode } from "react";
import type { WidgetKind } from "../data/editor";

/** 控件缩略图使用简化的组件造型，让相近的控件也能在小尺寸下区分。 */
export default function ControlThumb({ kind }: { kind: WidgetKind }) {
  const gradientId = `control-metal-${useId().replaceAll(":", "")}`;
  const metal = `url(#${gradientId})`;
  const light = "#b9c6d1", muted = "#71808f", dark = "#26313d", accent = "#8bbdea";
  let content: ReactNode;

  switch (kind) {
    case "dropdown":
      content = <>
        <rect x="14" y="8" width="44" height="11" rx="2" fill={metal}/>
        <path d="m50 12 3 3 3-3" fill="none" stroke={dark} strokeWidth="1.4"/>
        <rect x="14" y="21" width="44" height="19" rx="2" fill="#303b46" stroke={muted}/>
        <path d="M19 26h28M19 31h24M19 36h27" stroke={light} strokeWidth="1.5" opacity=".7"/>
      </>;
      break;
    case "groupPanel":
      content = <>
        <rect x="15" y="9" width="42" height="30" rx="2.5" fill={metal}/>
        <rect x="18" y="16" width="36" height="20" rx="1" fill="#202a35"/>
        <path d="M18 21h36M29 21v15" stroke={muted} strokeWidth="1.3"/>
        <path d="M32 25h17M32 29h12M32 33h15" stroke={light} strokeWidth="1" opacity=".6"/>
      </>;
      break;
    case "list":
      content = <>
        <path d="M19 13h34M16 18h40" stroke={light} strokeWidth="2" strokeLinecap="round"/>
        <rect x="13" y="21" width="46" height="18" rx="2" fill={metal}/>
        <path d="M19 27h34M19 32h27" stroke={dark} strokeWidth="1.3" opacity=".7"/>
      </>;
      break;
    case "button":
      content = <>
        <rect x="13" y="14" width="43" height="22" rx="3" fill={metal}/>
        <text x="21" y="29" fill="#202a34" fontSize="11" fontWeight="700">Btn</text>
        <path d="m45 27 2 15 4-5 6 3-6-7 5-1Z" fill="#171e27" stroke={light} strokeWidth="1"/>
      </>;
      break;
    case "dialog":
      content = <>
        <rect x="18" y="9" width="36" height="30" rx="3" fill={metal}/>
        <rect x="21" y="17" width="30" height="19" rx="1" fill="#171e26"/>
        <path d="m47 11 3 3m0-3-3 3" stroke={dark} strokeWidth="1.2"/>
        <path d="M25 22h18M25 26h13" stroke={muted} strokeWidth="1.1"/>
      </>;
      break;
    case "tabs":
      content = <>
        <path d="M14 14h10v-4h10v4h5v-4h10v4h9v23H14Z" fill={metal}/>
        <path d="M18 21h36M19 26h22M19 30h28" stroke={dark} strokeWidth="1.2" opacity=".65"/>
      </>;
      break;
    case "menuVertical":
      content = <>
        <rect x="25" y="6" width="22" height="36" rx="2" fill="#26323e" stroke={muted}/>
        <rect x="28" y="9" width="16" height="6" rx="1" fill={metal}/>
        <path d="M29 20h14M29 25h14M29 30h14M29 35h14" stroke={light} strokeWidth="2"/>
      </>;
      break;
    case "menuHorizontal":
      content = <>
        <rect x="9" y="18" width="54" height="13" rx="2" fill="#26323e" stroke={muted}/>
        <rect x="11" y="20" width="15" height="9" rx="1" fill={metal}/>
        <path d="M30 24.5h12M46 24.5h12" stroke={light} strokeWidth="2"/>
      </>;
      break;
    case "search":
      content = <>
        <rect x="10" y="16" width="52" height="17" rx="8.5" fill={metal}/>
        <path d="M18 24.5h22" stroke={dark} strokeWidth="1.4" opacity=".5"/>
        <circle cx="50" cy="23" r="4" fill="none" stroke={dark} strokeWidth="2"/>
        <path d="m53 26 3 3" stroke={dark} strokeWidth="2" strokeLinecap="round"/>
      </>;
      break;
    case "progress":
      content = <>
        <path d="M10 25h52" stroke={muted} strokeWidth="3" strokeLinecap="round"/>
        <path d="M10 25h28" stroke={light} strokeWidth="3" strokeLinecap="round"/>
        <circle cx="38" cy="25" r="4" fill={metal} stroke="#0c0e12" strokeWidth="1.5"/>
        <circle cx="10" cy="25" r="2" fill={light}/><circle cx="62" cy="25" r="2" fill={muted}/>
      </>;
      break;
    case "iframe":
      content = <>
        <rect x="17" y="9" width="38" height="30" rx="3" fill={metal}/>
        <rect x="20" y="16" width="32" height="20" rx="1" fill="#202a35"/>
        <path d="m30 22-4 4 4 4m12-8 4 4-4 4m-4-10-4 12" fill="none" stroke={light} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </>;
      break;
    case "weather":
      content = <>
        <circle cx="43" cy="17" r="7" fill={accent} opacity=".7"/>
        <path d="M22 35a8 8 0 0 1 1-16 12 12 0 0 1 22 2 7 7 0 0 1 2 14Z" fill={metal}/>
      </>;
      break;
    case "clock":
      content = <>
        <rect x="10" y="13" width="52" height="23" rx="3" fill="#26323e" stroke={muted}/>
        <text x="16" y="29" fill={light} fontSize="12" fontWeight="600" letterSpacing="1">12:08</text>
      </>;
      break;
    case "calendar":
      content = <>
        <rect x="17" y="9" width="38" height="31" rx="3" fill={metal}/>
        <path d="M17 18h38M25 6v6M47 6v6" stroke={dark} strokeWidth="2"/>
        <path d="M24 23h4m5 0h4m5 0h4M24 28h4m5 0h4m5 0h4M24 33h4m5 0h4m5 0h4" stroke={dark} strokeWidth="2" strokeLinecap="round"/>
      </>;
      break;
    case "timer":
      content = <>
        <circle cx="36" cy="26" r="14" fill={metal}/><circle cx="36" cy="26" r="10" fill="#26323e"/>
        <path d="M36 19v7l5 3M32 7h8M36 7v5" fill="none" stroke={light} strokeWidth="2" strokeLinecap="round"/>
      </>;
      break;
    case "timeline":
      content = <>
        <path d="M11 24h50" stroke={muted} strokeWidth="2"/>
        <circle cx="14" cy="24" r="4" fill={metal}/><circle cx="36" cy="24" r="4" fill={accent}/><circle cx="58" cy="24" r="4" fill={metal}/>
        <path d="M10 34h8M32 34h8M54 34h8" stroke={light} strokeWidth="1.3" strokeLinecap="round"/>
      </>;
      break;
    case "shape":
      content = <>
        <circle cx="25" cy="18" r="8" fill={metal}/>
        <rect x="34" y="23" width="17" height="17" rx="1.5" fill={metal} opacity=".85"/>
        <path d="M15 39 24 24l9 15Z" fill={accent} opacity=".85"/>
      </>;
      break;
    case "timePicker":
      content = <>
        <rect x="11" y="15" width="50" height="19" rx="3" fill="#26323e" stroke={muted}/>
        <text x="16" y="28" fill={light} fontSize="9" fontWeight="600">08:00</text>
        <circle cx="52" cy="24.5" r="5" fill="none" stroke={light} strokeWidth="1.3"/>
        <path d="M52 21.5v3l2 1.5" fill="none" stroke={light} strokeWidth="1.2"/>
      </>;
      break;
    case "timeRange":
      content = <>
        <rect x="4" y="15" width="27" height="18" rx="2" fill="#26323e" stroke={muted}/>
        <rect x="41" y="15" width="27" height="18" rx="2" fill="#26323e" stroke={muted}/>
        <text x="7" y="27" fill={light} fontSize="7">08:00</text><text x="44" y="27" fill={light} fontSize="7">20:00</text>
        <path d="M34 24h4" stroke={light} strokeWidth="1.5"/>
      </>;
      break;
    case "twin2d":
      content = <><rect x="9" y="7" width="54" height="34" fill="#26323e" stroke={light}/><path d="M13 11h20v12H13zM36 11h23v12H36zM13 26h15v11H13zM31 26h28v11H31z" fill={metal}/></>; break;
    case "checkbox":
      content = <><rect x="25" y="13" width="22" height="22" rx="3" fill={metal}/><path d="m29 24 5 5 9-10" fill="none" stroke={dark} strokeWidth="3"/></>; break;
    case "input":
      content = <><rect x="11" y="15" width="50" height="18" rx="3" fill="#26323e" stroke={light}/><text x="16" y="27" fill={light} fontSize="8">请输入</text></>; break;
    case "switch":
      content = <><rect x="16" y="15" width="40" height="19" rx="10" fill="#26323e" stroke={light}/><circle cx="26" cy="24.5" r="7" fill={metal}/></>; break;
    case "slider": case "timeProgress":
      content = <><path d="M10 25h50" stroke={light} strokeWidth="3"/><circle cx="38" cy="25" r="5" fill={metal}/>{kind === "timeProgress" && <text x="28" y="15" fill={light} fontSize="8">12:00</text>}</>; break;
    case "colorPicker":
      content = <><circle cx="36" cy="24" r="15" fill={metal}/><circle cx="30" cy="18" r="2" fill={dark}/><circle cx="39" cy="16" r="2" fill={dark}/><circle cx="44" cy="23" r="2" fill={dark}/></>; break;
    case "upload":
      content = <><rect x="19" y="13" width="34" height="25" rx="3" fill={metal}/><path d="M36 32V17m-6 6 6-6 6 6" fill="none" stroke={dark} strokeWidth="2.5"/></>; break;
    case "tree":
      content = <><path d="M23 13v22h10M23 24h10" fill="none" stroke={light} strokeWidth="2"/><rect x="18" y="8" width="10" height="9" fill={metal}/><rect x="33" y="20" width="18" height="8" fill={metal}/><rect x="33" y="31" width="18" height="8" fill={metal}/></>; break;
    default:
      content = <rect x="18" y="10" width="36" height="28" rx="3" fill={metal}/>;
  }

  return <svg viewBox="0 0 72 48" aria-hidden="true" focusable="false">
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
      <stop stopColor="#e1e8ed"/><stop offset=".48" stopColor="#9daab5"/><stop offset="1" stopColor="#5e6d7b"/>
    </linearGradient></defs>
    {content}
  </svg>;
}
