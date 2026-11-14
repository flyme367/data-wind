import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { readBoardMedia } from "../state/boardMedia";
import type { BoardStateStyle, EditorSettings } from "../data/editor";
import { useStore } from "../state/store";

interface MediaView { url: string; type: string; objectUrl: boolean }

async function resolveMedia(id: string): Promise<MediaView> {
  if (!id) return { url: "", type: "", objectUrl: false };
  if (/^https?:\/\//i.test(id)) return { url: id, type: "", objectUrl: false };
  if (id.startsWith("./") || id.startsWith("media/")) {
    const type = /\.(mp4|webm|mov)$/i.test(id) ? "video/mp4" : "";
    return { url: new URL(id, window.location.href).href, type, objectUrl: false };
  }
  const record = await readBoardMedia(id);
  return record
    ? { url: URL.createObjectURL(record.blob), type: record.type, objectUrl: true }
    : { url: "", type: "", objectUrl: false };
}

function Backdrop({ url, type, settings, className }: {
  url: string; type: string; settings: BoardStateStyle; className: string;
}) {
  if (!settings.boardBackgroundEnabled || !url) return null;
  const isVideo = type.startsWith("video/");
  const tile = settings.boardBackgroundFill === "tile" && !isVideo;
  const mediaStyle: CSSProperties = {
    filter: `blur(${settings.boardBackgroundBlur ?? 0}px)`, transform: "scale(1.04)",
    ...(tile ? { backgroundImage: `url(${JSON.stringify(url)})`, backgroundRepeat: "repeat", backgroundSize: "auto" } : {}),
  };
  return <div className={`board-backdrop ${className}`} aria-hidden="true">
    {isVideo ? <video src={url} autoPlay loop muted playsInline style={mediaStyle}/>
      : tile ? <div className="board-backdrop-image" style={mediaStyle}/>
        : <img src={url} alt="" style={{ ...mediaStyle,
          objectFit: settings.boardBackgroundFill === "stretch" ? "fill"
            : settings.boardBackgroundFill === "none" ? "none" : "contain" }}/>} 
  </div>;
}

export default function BoardBackground({ preview, settingsOverride, includeSharedBackground = false }: {
  preview: boolean; settingsOverride?: EditorSettings; includeSharedBackground?: boolean;
}) {
  const state = useStore();
  const settings = settingsOverride ?? state.settings;
  const sharedSettings = includeSharedBackground ? state.settings.boardBackgroundPage.style : null;
  const musicSettings = sharedSettings?.boardMusicEnabled && !settings.boardMusicEnabled ? sharedSettings : settings;
  const audio = useRef<HTMLAudioElement>(null);
  const [background, setBackground] = useState<MediaView>({ url: "", type: "", objectUrl: false });
  const [sharedBackground, setSharedBackground] = useState<MediaView>({ url: "", type: "", objectUrl: false });
  const [music, setMusic] = useState<MediaView>({ url: "", type: "", objectUrl: false });

  useEffect(() => {
    let disposed = false;
    const created: string[] = [];
    void Promise.all([
      resolveMedia(settings.boardBackgroundMediaId),
      resolveMedia(musicSettings.boardMusicId ?? ""),
      resolveMedia(sharedSettings?.boardBackgroundMediaId ?? ""),
    ]).then(([pageBackground, pageMusic, shared]) => {
      if (disposed) {
        for (const item of [pageBackground, pageMusic, shared]) if (item.objectUrl) URL.revokeObjectURL(item.url);
        return;
      }
      for (const item of [pageBackground, pageMusic, shared]) if (item.objectUrl) created.push(item.url);
      setBackground(pageBackground);
      setMusic(pageMusic);
      setSharedBackground(shared);
    }).catch(() => {
      if (!disposed) {
        setBackground({ url: "", type: "", objectUrl: false });
        setMusic({ url: "", type: "", objectUrl: false });
        setSharedBackground({ url: "", type: "", objectUrl: false });
      }
    });
    return () => { disposed = true; created.forEach(URL.revokeObjectURL); };
  }, [settings.boardBackgroundMediaId, musicSettings.boardMusicId, sharedSettings?.boardBackgroundMediaId]);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.volume = Math.max(0, Math.min(1, (musicSettings.boardMusicVolume ?? 100) / 100));
    if (preview && musicSettings.boardMusicEnabled && music.url) void element.play().catch(() => {});
    else element.pause();
  }, [preview, music.url, musicSettings.boardMusicEnabled, musicSettings.boardMusicVolume]);

  useEffect(() => {
    const toggle = () => {
      const element = audio.current;
      if (!element || !music.url) return;
      element.volume = Math.max(0, Math.min(1, (musicSettings.boardMusicVolume ?? 100) / 100));
      if (element.paused) void element.play().catch(() => {});
      else element.pause();
    };
    window.addEventListener("dw:toggle-board-music", toggle);
    return () => window.removeEventListener("dw:toggle-board-music", toggle);
  }, [music.url, musicSettings.boardMusicVolume]);

  return <>
    {sharedSettings && <Backdrop url={sharedBackground.url} type={sharedBackground.type}
      settings={sharedSettings} className="board-backdrop-shared"/>}
    <div className="board-page-color" aria-hidden="true" style={{
      background: settings.boardBackgroundEnabled ? settings.boardColor : "transparent",
    }}/>
    <Backdrop url={background.url} type={background.type} settings={settings} className="board-backdrop-page"/>
    {music.url && <audio ref={audio} src={music.url} loop preload="auto" aria-label="看板背景音乐" />}
  </>;
}
