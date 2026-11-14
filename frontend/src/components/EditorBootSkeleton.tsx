import { Skeleton } from "@/components/ui/skeleton";

/**
 * 山海鲸式编辑器首开加载骨架：占位块按编辑器真实布局铺排
 * （顶栏 36px / 图层 170px / 素材栏 56px / 画布点阵 / 属性面板 / 底栏 40px），
 * 加载完成后由 WorkspacePage 整体淡出。
 */
export default function EditorBootSkeleton({ projectName, hiding }: { projectName: string; hiding: boolean }) {
  const paragraph = (rows: number, className?: string) =>
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-2.5 w-full" />)}
    </div>;
  return <div className={`editor-boot ${hiding ? "is-hiding" : ""}`}>
    <div className="editor-boot-header">
      {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-6 w-16 rounded-[3px]" />)}
      <Skeleton className="mx-auto h-4 w-[220px]" />
      <Skeleton className="h-6 w-14 rounded-[3px]" />
    </div>
    <div className="editor-boot-body">
      <div className="editor-boot-tree">
        <Skeleton className="h-4 w-24" />
        {paragraph(12, "w-[84%]")}
      </div>
      <div className="editor-boot-rail">
        {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="size-7 rounded-md" />)}
      </div>
      <div className="editor-boot-stage">
        <div className="editor-boot-stage-inner">
          <p className="editor-boot-hint">正在打开「{projectName}」…</p>
          <Skeleton className="h-5 w-[52%]" />
          {paragraph(2, "w-[38%]")}
        </div>
      </div>
      <div className="editor-boot-props">
        <Skeleton className="h-4 w-[88px]" />
        {paragraph(14)}
      </div>
    </div>
    <div className="editor-boot-footer">
      <Skeleton className="h-[22px] w-[26px] rounded-[3px]" />
      <Skeleton className="h-[22px] w-16 rounded-[3px]" />
      {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-[22px] w-[72px] rounded-[3px]" />)}
      <Skeleton className="ml-auto h-[22px] w-24 rounded-[3px]" />
    </div>
  </div>;
}
