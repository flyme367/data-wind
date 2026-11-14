import type { Interaction, WidgetConfig } from "./data/editor";
import type { DataSourceConfig } from "./data/dataSources";
import type { TerrainConfig } from "./data/terrain";
import type { WaterConfig } from "./data/water";
export type NodeType =
  | "group"
  | "model"
  | "terrain"
  | "water"
  | "marker"
  | "flyline"
  | "fence"
  | "light"
  | "camera"
  | "widget";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface SceneNode {
  id: string;
  name: string;
  type: NodeType;
  visible: boolean;
  locked: boolean;
  transform: Transform;
  color: string;
  parentId: string | null;
  widget?: WidgetConfig;
  data?: Record<string, unknown>;
  dataSource?: DataSourceConfig;
  /** 看板公共数据管理器中的可复用数据源 ID。 */
  sharedDataSourceId?: string;
  /** 看板组件所属的子看板页面；未标注的旧项目组件自动归入第一页。 */
  boardPageId?: string;
  bindings?: Record<string, string>;
  interactions?: Interaction[];
  lightIntensity?: number;
  customMesh?: { bytes: string; triangles: number; sourceName: string };
  /** model 几何包围盒尺寸 */
  boxSize?: Vec3;
  /** Resource in the local, attributed glTF model library. */
  modelId?: string;
  terrain?: TerrainConfig;
  water?: WaterConfig;
  /** flyline 终点 */
  to?: Vec3;
}

export type InstanceKind = "box" | "mesh" | "terrain" | "water" | "marker" | "flyline" | "fence";

export interface FlatInstance {
  id: string;
  kind: InstanceKind;
  locked?: boolean;
  pos: [number, number, number];
  size: [number, number, number];
  rotY: number;
  rotation?: [number, number, number];
  color: [number, number, number];
  modelId?: string;
  terrain?: TerrainConfig;
  water?: WaterConfig;
  to?: [number, number, number];
}

export interface EngineStats {
  backend: string;
  fps: number;
  instances: number;
  visible: number;
  particles: number;
  tris: number;
}

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  group: "分组",
  model: "模型",
  terrain: "地形",
  water: "水体",
  marker: "标记点",
  flyline: "飞线",
  fence: "电子围栏",
  light: "灯光",
  camera: "相机",
  widget: "看板组件",
};
