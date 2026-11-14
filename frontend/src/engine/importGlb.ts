import type { SceneNode } from "../types";

const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const multiply=(a:number[],b:number[])=>Array.from({length:16},(_,i)=>{const row=i%4,col=Math.floor(i/4);let sum=0;for(let j=0;j<4;j++)sum+=a[row+j*4]*b[j+col*4];return sum});
const point=(m:number[],p:number[])=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
function matrix(node:Record<string,any>):number[]{
  if(Array.isArray(node.matrix)&&node.matrix.length===16)return node.matrix;
  const [x,y,z,w]=node.rotation??[0,0,0,1],s=node.scale??[1,1,1],t=node.translation??[0,0,0];
  return [(1-2*(y*y+z*z))*s[0],2*(x*y+z*w)*s[0],2*(x*z-y*w)*s[0],0,2*(x*y-z*w)*s[1],(1-2*(x*x+z*z))*s[1],2*(y*z+x*w)*s[1],0,2*(x*z+y*w)*s[2],2*(y*z-x*w)*s[2],(1-2*(x*x+y*y))*s[2],0,t[0],t[1],t[2],1];
}
const signOne=(value:number)=>value<0?-1:1;
// 法线八面体编码（snorm16），与 engine-rs/data-wind-cpu/src/mesh.rs 的 oct_decode 配对。
const octEncode=(n:number[]):[number,number]=>{
  const sum=Math.abs(n[0])+Math.abs(n[1])+Math.abs(n[2])||1;
  let x=n[0]/sum,y=n[1]/sum;
  if(n[2]<0){const oldX=x;x=(1-Math.abs(y))*signOne(x);y=(1-Math.abs(oldX))*signOne(y);}
  const clamp16=(value:number)=>Math.max(-32768,Math.min(32767,Math.round(value*32767)));
  return [clamp16(x),clamp16(y)];
};
export function meshGeometry(vertices: number[]) {
  if(!vertices.length||vertices.length%27||vertices.some(v=>!Number.isFinite(v)))throw new Error("模型缺少有效三角形");
  if(vertices.length/9>60_000)throw new Error("模型超过 2 万个三角面，请先简化模型后导入");
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<vertices.length;i+=9)for(let a=0;a<3;a++){min[a]=Math.min(min[a],vertices[i+a]);max[a]=Math.max(max[a],vertices[i+a])}
  const dimensions=max.map((v,i)=>Math.max(.001,v-min[i])),center=max.map((v,i)=>(v+min[i])/2);
  for(let i=0;i<vertices.length;i+=9){const normal=dimensions.map((v,a)=>vertices[i+3+a]*v),length=Math.hypot(...normal)||1;for(let a=0;a<3;a++){vertices[i+a]=(vertices[i+a]-center[a])/dimensions[a];vertices[i+3+a]=normal[a]/length}}
  // DWM2：9 元组去重建索引 + 量化（position u16×3 / 法线八面体 i16×2 / 颜色 u8×3）。
  // 解码端见 engine-rs/data-wind-cpu/src/mesh.rs decode_dwm2。
  const unique=new Map<string,number>(),uniqueList:number[][]=[],slots:number[]=[];
  for(let i=0;i<vertices.length;i+=9){
    const corner=vertices.slice(i,i+9);
    const key=corner.join("|");
    let slot=unique.get(key);
    if(slot===undefined){slot=uniqueList.length;unique.set(key,slot);uniqueList.push(corner);}
    slots.push(slot);
  }
  const wide=slots.length>65535;
  const buffer=new ArrayBuffer(16+uniqueList.length*13+slots.length*(wide?4:2)),header=new DataView(buffer);
  header.setUint32(0,0x324d5744,true);header.setUint32(4,uniqueList.length,true);header.setUint32(8,slots.length,true);header.setUint8(12,wide?1:0);
  uniqueList.forEach((corner,index)=>{
    const base=16+index*13;
    for(let a=0;a<3;a++)header.setUint16(base+a*2,Math.max(0,Math.min(65535,Math.round((corner[a]+.5)*65535))),true);
    const [nx,ny]=octEncode([corner[3],corner[4],corner[5]]);
    header.setInt16(base+6,nx,true);header.setInt16(base+8,ny,true);
    for(let a=0;a<3;a++)header.setUint8(base+10+a,Math.max(0,Math.min(255,Math.round(corner[6+a]*255))));
  });
  const indexBase=16+uniqueList.length*13;
  slots.forEach((value,index)=>wide?header.setUint32(indexBase+index*4,value,true):header.setUint16(indexBase+index*2,value,true));
  return { bytes: new Uint8Array(buffer), center, dimensions, triangles: vertices.length / 27 };
}

export function meshNode(name:string,vertices:number[],worldSize?:number[]): Partial<SceneNode>&{type:"model"} {
  const geometry = meshGeometry(vertices);
  const size = worldSize ?? geometry.dimensions.map(v => v / Math.max(...geometry.dimensions) * 8);
  let binary = "";
  for (const byte of geometry.bytes) binary += String.fromCharCode(byte);
  return{type:"model",name:name.replace(/\.glb$/i,""),modelId:`custom-${crypto.randomUUID()}`,customMesh:{bytes:btoa(binary),triangles:geometry.triangles,sourceName:name},color:"#FFFFFF",boxSize:{x:size[0],y:size[1],z:size[2]},transform:{position:{x:0,y:size[1]/2+.12,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}};
}
/** Decode a self-contained, uncompressed glTF 2.0 binary without executing external code. */
export function importGlb(bytes:ArrayBuffer,name:string):Partial<SceneNode>&{type:"model"}{
  const view=new DataView(bytes);if(bytes.byteLength<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength)throw new Error("请选择有效的 glTF 2.0 GLB 文件");
  let json:Record<string,any>|undefined,bin:Uint8Array|undefined;
  for(let offset=12;offset+8<=bytes.byteLength;){const len=view.getUint32(offset,true),kind=view.getUint32(offset+4,true);offset+=8;if(offset+len>bytes.byteLength)throw new Error("GLB 数据不完整");const chunk=new Uint8Array(bytes,offset,len);if(kind===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(chunk));if(kind===0x004e4942)bin=chunk;offset+=len;}
  if(!json||!bin)throw new Error("GLB 必须包含内嵌几何数据");
  if((json.extensionsRequired??[]).some((name:string)=>["KHR_draco_mesh_compression","EXT_meshopt_compression"].includes(name)))throw new Error("请先解压 Draco / Meshopt 几何，再导出为普通 GLB");
  const gltf=json,data=bin;
  const accessor=(id:number):number[][]=>{
    const a=gltf.accessors?.[id],b=gltf.bufferViews?.[a?.bufferView];if(!a||!b||a.sparse||b.buffer!==0||a.count>200_000)throw new Error("模型包含不支持的外部、稀疏或过大的顶点数据");
    const dimensions=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16} as Record<string,number>)[a.type],size=({5120:1,5121:1,5122:2,5123:2,5125:4,5126:4} as Record<number,number>)[a.componentType];
    if(!dimensions||!size)throw new Error("模型顶点格式不支持");
    const stride=b.byteStride??dimensions*size,start=(b.byteOffset??0)+(a.byteOffset??0),result:number[][]=[],v=new DataView(data.buffer,data.byteOffset,data.byteLength);
    if(start<0||stride<dimensions*size||start+(a.count-1)*stride+dimensions*size>data.byteLength)throw new Error("模型顶点超出缓冲区范围");
    for(let i=0;i<a.count;i++){const row=[];for(let k=0;k<dimensions;k++){const p=start+i*stride+k*size;let n=a.componentType===5126?v.getFloat32(p,true):a.componentType===5125?v.getUint32(p,true):a.componentType===5123?v.getUint16(p,true):a.componentType===5122?v.getInt16(p,true):a.componentType===5121?v.getUint8(p):v.getInt8(p);if(a.normalized)n=Math.max(-1,n/(a.componentType===5121?255:a.componentType===5120?127:a.componentType===5123?65535:32767));row.push(n)}result.push(row)}return result;
  };
  const vertices:number[]=[],visited=new Set<number>();
  const visit=(id:number,parent:number[],depth=0)=>{const n=gltf.nodes?.[id];if(!n||depth>128||visited.has(id))throw new Error("模型节点结构无效");visited.add(id);const m=multiply(parent,matrix(n));
    for(const primitive of gltf.meshes?.[n.mesh]?.primitives??[]){if(primitive.mode!==undefined&&primitive.mode!==4)continue;if(primitive.extensions?.KHR_draco_mesh_compression)throw new Error("请先解压 Draco 模型");
      const positions=accessor(primitive.attributes.POSITION),colors=primitive.attributes.COLOR_0!==undefined?accessor(primitive.attributes.COLOR_0):null,indices=primitive.indices!==undefined?accessor(primitive.indices).map(r=>r[0]):positions.map((_,i)=>i);
      const color=gltf.materials?.[primitive.material]?.pbrMetallicRoughness?.baseColorFactor??[.7,.75,.8,1];
      for(let i=0;i+2<indices.length;i+=3){const points=indices.slice(i,i+3).map(index=>{if(!positions[index])throw new Error("模型索引无效");return point(m,positions[index])});const a=points[1].map((v,k)=>v-points[0][k]),b=points[2].map((v,k)=>v-points[0][k]),normal=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...normal);if(length<1e-10)continue;
        for(let k=0;k<3;k++)vertices.push(...points[k],...normal.map(v=>v/length),...[0,1,2].map(channel=>color[channel]*(colors?.[indices[i+k]]?.[channel]??1)));
        if(vertices.length/9>60_000)throw new Error("模型超过 2 万个三角面，请先简化模型后导入");
      }
    }
    for(const child of n.children??[])visit(child,m,depth+1);visited.delete(id);
  };
  const roots=gltf.scenes?.[gltf.scene??0]?.nodes??gltf.nodes?.map((_:unknown,i:number)=>i).filter((i:number)=>!gltf.nodes.some((n:any)=>n.children?.includes(i)))??[];
  roots.forEach((id:number)=>visit(id,identity()));return meshNode(name,vertices);
}
