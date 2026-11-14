import { useEffect, useRef, useState } from "react";
import { Button, Empty, Toast } from "@douyinfe/semi-ui";
import { Cube, Delete, Download, Folder, Plus } from "@icon-park/react";
import { importModelFiles } from "../engine/modelAsset";
import { deleteModelAsset, getModelAsset, listModelAssets, onModelAssetsChanged, saveModelAsset, type ModelAssetMeta } from "../state/modelAssets";

export function modelAssetError(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "模型操作失败";
}

export function useModelAssets() {
  const [assets, setAssets] = useState<ModelAssetMeta[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const update = () => { listModelAssets().then((items) => { if (alive) { setAssets(items); setError(""); } })
      .catch((failure: unknown) => { if (alive) setError(modelAssetError(failure)); }); };
    update();
    const unsubscribe = onModelAssetsChanged(update);
    return () => { alive = false; unsubscribe(); };
  }, []);
  return { assets, error };
}

export default function ModelAssetLibrary() {
  const { assets, error } = useModelAssets();
  const [busy, setBusy] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const { bytes, sourceName } = await importModelFiles(files);
      const asset = await saveModelAsset(bytes, sourceName);
      Toast.success(`“${asset.name}”已保存到模型资产库`);
    } catch (failure) { Toast.error(modelAssetError(failure)); }
    finally { setBusy(false); }
  };
  const download = async (asset: ModelAssetMeta) => {
    try {
      const bytes = await getModelAsset(asset.id);
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${asset.name}.dwasset`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { Toast.error(modelAssetError(failure)); }
  };
  const remove = async (asset: ModelAssetMeta) => {
    try { await deleteModelAsset(asset.id); Toast.success(`已删除“${asset.name}”`); }
    catch (failure) { Toast.error(modelAssetError(failure)); }
  };
  return <>
    <div className="content-title"><h1>我的模型</h1><span>导入 Blender 导出的模型，保存到本地资产库</span></div>
    <div className="model-import-actions">
      <Button theme="solid" icon={<Plus />} loading={busy} disabled={busy} onClick={() => filesRef.current?.click()}>导入模型</Button>
      <Button icon={<Folder />} disabled={busy} onClick={() => folderRef.current?.click()}>选择模型文件夹</Button>
    </div>
    <p className="model-import-help">支持 GLB、glTF、OBJ 和 .dwasset。外部 .bin、.mtl 与贴图需同时选择；包含子目录时请选择文件夹。单次导入一个模型，文件总计不超过 20 MB。</p>
    <p className="model-import-help">资产保存在当前浏览器，可下载 .dwasset 供 Bevy 使用。编辑器使用顶点颜色近似显示贴图。</p>
    <input hidden ref={filesRef} type="file" multiple aria-label="选择模型及关联文件" onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = ""; void importFiles(files);
    }} />
    <input hidden ref={folderRef} type="file" multiple {...{ webkitdirectory: "" }} aria-label="选择模型文件夹" onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = ""; void importFiles(files);
    }} />
    {error && <p role="alert" className="model-import-error">{error}</p>}
    {assets.length ? <div className="model-library-grid">{assets.map((asset) => <article key={asset.id} className="model-library-card">
      <div className="model-library-icon"><Cube size={38} /></div>
      <div className="model-library-info"><strong title={asset.name}>{asset.name}</strong><small>{asset.triangles.toLocaleString()} 个三角面 · {asset.textures} 张贴图</small><small>{(asset.size / 1024 / 1024).toFixed(2)} MiB · {asset.sourceName}</small></div>
      <div className="model-library-actions"><Button size="small" icon={<Download />} aria-label={`下载模型 ${asset.name}`} onClick={() => void download(asset)}>下载</Button>
        <Button size="small" icon={<Delete />} aria-label={`删除模型 ${asset.name}`} onClick={() => void remove(asset)} /></div>
    </article>)}</div> : !error && <Empty description="还没有模型，导入后可在项目的 3D 模型素材库中使用" />}
  </>;
}
