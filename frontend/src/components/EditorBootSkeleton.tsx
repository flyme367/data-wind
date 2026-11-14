import { Skeleton } from "@douyinfe/semi-ui";

/**
 * 山海鲸式编辑器首开加载骨架：占位块按编辑器真实布局铺排
 * （顶栏 36px / 图层 170px / 素材栏 56px / 画布点阵 / 属性面板 / 底栏 40px），
 * 加载完成后由 WorkspacePage 整体淡出。
 */
export default function EditorBootSkeleton({ projectName, hiding }: { projectName: string; hiding: boolean }) {
  return <Skeleton className={`editor-boot ${hiding ? "is-hiding" : ""}`} active loading placeholder={<>
    <div className="editor-boot-header">
      {Array.from({ length: 6 }, (_, index) => <Skeleton.Button key={index} style={{ width: 64, height: 24, borderRadius: 3 }} />)}
      <Skeleton.Title style={{ width: 220, margin: "0 auto" }} />
      <Skeleton.Button style={{ width: 56, height: 24, borderRadius: 3 }} />
    </div>
    <div className="editor-boot-body">
      <div className="editor-boot-tree">
        <Skeleton.Title style={{ width: 96 }} />
        <Skeleton.Paragraph rows={12} style={{ width: "84%" }} />
      </div>
      <div className="editor-boot-rail">
        {Array.from({ length: 8 }, (_, index) => <Skeleton.Button key={index} style={{ width: 28, height: 28 }} />)}
      </div>
      <div className="editor-boot-stage">
        <div className="editor-boot-stage-inner">
          <p className="editor-boot-hint">正在打开「{projectName}」…</p>
          <Skeleton.Title style={{ width: "52%" }} />
          <Skeleton.Paragraph rows={2} style={{ width: "38%" }} />
        </div>
      </div>
      <div className="editor-boot-props">
        <Skeleton.Title style={{ width: 88 }} />
        <Skeleton.Paragraph rows={14} />
      </div>
    </div>
    <div className="editor-boot-footer">
      <Skeleton.Button style={{ width: 26, height: 22, borderRadius: 3 }} />
      <Skeleton.Button style={{ width: 64, height: 22, borderRadius: 3 }} />
      {Array.from({ length: 8 }, (_, index) => <Skeleton.Button key={index} style={{ width: 72, height: 22, borderRadius: 3 }} />)}
      <Skeleton.Button style={{ width: 96, height: 22, borderRadius: 3, marginLeft: "auto" }} />
    </div>
  </>} />;
}
