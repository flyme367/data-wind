import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { writeMinWebp, readImagePng } from './lib-webp.mjs';
const directory = fileURLToPath(new URL('../public/models/', import.meta.url));
// 原始 GLB 源仅供构建管线使用，不放 public/（62MB，曾被打进 dist）。
const sourceDirectory = fileURLToPath(new URL('../model-sources/', import.meta.url));
const output = fileURLToPath(new URL('../src/data/modelCatalog.ts', import.meta.url));
const sources = JSON.parse(await readFile(`${directory}/sources.json`, 'utf8'));
const identity = () => [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize = (v) => { const n=Math.hypot(...v)||1; return v.map(x=>x/n); };
const multiply = (a,b) => Array.from({length:16},(_,i)=>{const r=i%4,c=i>>2;return [0,1,2,3].reduce((sum,k)=>sum+a[k*4+r]*b[c*4+k],0);});
const point = (m,p) => [0,1,2].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]);
function trs(node) {
  if (node.matrix) return node.matrix;
  const [x,y,z,w]=node.rotation??[0,0,0,1],s=node.scale??[1,1,1],t=node.translation??[0,0,0];
  return [(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,
    (2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,
    (2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,...t,1];
}
function transformNormal(m,n) {
  const a=m.slice(0,3),b=m.slice(4,7),c=m.slice(8,11),bc=cross(b,c),ca=cross(c,a),ab=cross(a,b);
  const determinant=dot(a,bc)||1;
  return normalize([0,1,2].map(i=>(bc[i]*n[0]+ca[i]*n[1]+ab[i]*n[2])/determinant));
}
const linear = (v) => v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const srgb = (v) => Math.round(255*Math.min(1,Math.max(0,v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055)));
function orient(v, angles) {
  let [x,y,z]=angles.map(value=>value*Math.PI/180);
  const cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
  const py=v[1]*cx-v[2]*sx,pz=v[1]*sx+v[2]*cx;
  const px=v[0]*cy+pz*sy,pz2=-v[0]*sy+pz*cy;
  return [px*cz-py*sz,px*sz+py*cz,pz2];
}
const signOne = (value) => value<0?-1:1;
// 法线八面体编码（snorm16），与 engine-rs/data-wind-cpu/src/mesh.rs 的 oct_decode 配对。
const octEncode = (n) => {
  const sum=Math.abs(n[0])+Math.abs(n[1])+Math.abs(n[2])||1;
  let x=n[0]/sum,y=n[1]/sum;
  if(n[2]<0){const oldX=x;x=(1-Math.abs(y))*signOne(x);y=(1-Math.abs(oldX))*signOne(y);}
  const clamp16=(value)=>Math.max(-32768,Math.min(32767,Math.round(value*32767)));
  return [clamp16(x),clamp16(y)];
};
// DWM2：9 元组去重建索引 + 量化（position u16×3 / 法线八面体 i16×2 / 颜色 u8×3）+ u16/u32 索引。
// 解码端见 engine-rs/data-wind-cpu/src/mesh.rs decode_dwm2。
function encodeDwm2(vertices,center,size){
  const unique=new Map(),uniqueList=[],indices=[];
  for(const v of vertices){
    const position=v.p.map((p,i)=>(p-center[i])/size[i]);
    const normal=normalize(v.n.map((n,i)=>n*size[i]));
    const key=`${position}|${normal}|${v.c}`;
    let slot=unique.get(key);
    if(slot===undefined){slot=uniqueList.length;unique.set(key,slot);uniqueList.push({position,normal,color:v.c});}
    indices.push(slot);
  }
  const wide=uniqueList.length>65535;
  const payload=Buffer.alloc(16+uniqueList.length*13+indices.length*(wide?4:2));
  payload.write('DWM2');payload.writeUInt32LE(uniqueList.length,4);payload.writeUInt32LE(indices.length,8);payload[12]=wide?1:0;
  uniqueList.forEach((v,index)=>{
    const base=16+index*13;
    v.position.forEach((p,axis)=>payload.writeUInt16LE(Math.max(0,Math.min(65535,Math.round((p+.5)*65535))),base+axis*2));
    const [x,y]=octEncode(v.normal);payload.writeInt16LE(x,base+6);payload.writeInt16LE(y,base+8);
    v.color.forEach((c,axis)=>payload.writeUInt8(Math.max(0,Math.min(255,Math.round(c*255))),base+10+axis));
  });
  const indexBase=16+uniqueList.length*13;
  indices.forEach((value,index)=>wide?payload.writeUInt32LE(value,indexBase+index*4):payload.writeUInt16LE(value,indexBase+index*2));
  return payload;
}
async function prepare(source) {
  const bytes=await readFile(`${sourceDirectory}/${source.id}.glb`);
  if (bytes.readUInt32LE(0)!==0x46546c67 || bytes.readUInt32LE(4)!==2) throw Error(`${source.id}: invalid GLB`);
  let json,bin;
  for (let offset=12;offset<bytes.length;) {
    const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4),chunk=bytes.subarray(offset+8,offset+8+length);
    if(type===0x4e4f534a)json=JSON.parse(chunk.toString('utf8'));
    if(type===0x004e4942)bin=chunk;
    offset+=8+length;
  }
  const buffers=(json.buffers??[]).map(buffer=>buffer.uri?Buffer.from(buffer.uri.split(',')[1],'base64'):bin);
  const imageCache=new Map();
  async function image(index) {
    if(imageCache.has(index))return imageCache.get(index);
    const item=json.images[index];let data;
    if(item.bufferView!==undefined){const view=json.bufferViews[item.bufferView];data=buffers[view.buffer].subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);}
    else if(item.uri?.startsWith('data:'))data=Buffer.from(item.uri.split(',')[1],'base64');
    else data=await readImagePng(`${sourceDirectory}/${source.id}-texture-${index}`);
    const decoded=PNG.sync.read(data);imageCache.set(index,decoded);return decoded;
  }
  const typeSizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
  const components={5120:[1,'readInt8',127],5121:[1,'readUInt8',255],5122:[2,'readInt16LE',32767],5123:[2,'readUInt16LE',65535],5125:[4,'readUInt32LE',4294967295],5126:[4,'readFloatLE',1]};
  function accessor(index){
    const access=json.accessors[index],view=json.bufferViews[access.bufferView];
    if(!view || access.sparse)throw Error('Unsupported sparse/missing buffer view');
    const [size,method,max]=components[access.componentType],count=typeSizes[access.type],stride=view.byteStride??size*count;
    const data=buffers[view.buffer],offset=(view.byteOffset??0)+(access.byteOffset??0);
    return Array.from({length:access.count},(_,row)=>Array.from({length:count},(_,col)=>{
      const value=data[method](offset+row*stride+col*size);return access.normalized?Math.max(-1,value/max):value;
    }));
  }
  const vertices=[];
  async function visit(index,parent){
    const node=json.nodes[index],world=multiply(parent,trs(node));
    if(node.mesh!==undefined){
      for(const primitive of json.meshes[node.mesh].primitives){
        if((primitive.mode??4)!==4)throw Error('Model must contain triangle primitives');
        const positions=accessor(primitive.attributes.POSITION).map(p=>point(world,p));
        const normals=primitive.attributes.NORMAL===undefined?null:accessor(primitive.attributes.NORMAL).map(n=>transformNormal(world,n));
        const uv=primitive.attributes.TEXCOORD_0===undefined?null:accessor(primitive.attributes.TEXCOORD_0);
        const colors=primitive.attributes.COLOR_0===undefined?null:accessor(primitive.attributes.COLOR_0);
        const indices=primitive.indices===undefined?positions.map((_,i)=>i):accessor(primitive.indices).map(i=>i[0]);
        const material=json.materials?.[primitive.material]??{},pbr=material.pbrMetallicRoughness??{},factor=pbr.baseColorFactor??[1,1,1,1];
        if(factor[3]<.01)continue;
        const texture=pbr.baseColorTexture?await image(json.textures[pbr.baseColorTexture.index].source):null;
        for(let i=0;i<indices.length;i+=3){
          const tri=indices.slice(i,i+3),flatNormal=normalize(cross(positions[tri[1]].map((v,k)=>v-positions[tri[0]][k]),positions[tri[2]].map((v,k)=>v-positions[tri[0]][k])));
          for(const idx of tri){
            let color=factor.slice(0,3).map((v,k)=>v*(colors?.[idx]?.[k]??1));
            if(texture&&uv){const [u,v]=uv[idx];const x=Math.min(texture.width-1,Math.max(0,Math.floor(u*texture.width))),y=Math.min(texture.height-1,Math.max(0,Math.floor(v*texture.height)));const at=(y*texture.width+x)*4;color=color.map((channel,k)=>channel*linear(texture.data[at+k]/255));}
            vertices.push({p:positions[idx],n:normals?.[idx]??flatNormal,c:color});
          }
        }
      }
    }
    for(const child of node.children??[])await visit(child,world);
  }
  const roots=json.scenes?.[json.scene??0]?.nodes??json.nodes.map((_,i)=>i).filter(i=>!json.nodes.some(n=>n.children?.includes(i)));
  for(const root of roots)await visit(root,identity());
  if(!vertices.length)throw Error(`${source.id}: empty mesh`);
  if(source.orientation){
    for(const vertex of vertices){
      vertex.p=orient(vertex.p,source.orientation);
      vertex.n=normalize(orient(vertex.n,source.orientation));
    }
  }
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const v of vertices)for(let i=0;i<3;i++){min[i]=Math.min(min[i],v.p[i]);max[i]=Math.max(max[i],v.p[i]);}
  const size=min.map((v,i)=>Math.max(.01,max[i]-v)),center=min.map((v,i)=>(v+max[i])/2);
  const payload=encodeDwm2(vertices,center,size);
  await writeFile(`${directory}/${source.id}.mesh`,payload);
  // Render a consistent thumbnail from the same imported mesh, including its authored colors.
  const width=224,height=176,preview=new PNG({width,height}),depth=new Float32Array(width*height).fill(-Infinity);
  for(let i=0;i<preview.data.length;i+=4)preview.data.set([30,36,44,255],i);
  const direction=normalize([5,3.6,6]),right=normalize([direction[2],0,-direction[0]]),up=cross(direction,right);
  const projected=vertices.map(v=>{const p=v.p.map((value,i)=>value-center[i]);return [dot(p,right),dot(p,up),dot(p,direction)];});
  const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];for(const p of projected)for(let i=0;i<2;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}
  const scale=Math.min((width-30)/(hi[0]-lo[0]||1),(height-24)/(hi[1]-lo[1]||1));
  const screen=projected.map(p=>[(p[0]-(hi[0]+lo[0])/2)*scale+width/2,height/2-(p[1]-(hi[1]+lo[1])/2)*scale,p[2]]);
  const light=normalize([.45,.85,.35]);
  for(let t=0;t<screen.length;t+=3){
    const [a,b,c]=screen.slice(t,t+3),area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);if(Math.abs(area)<.01)continue;
    const left=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),rightEdge=Math.min(width-1,Math.ceil(Math.max(a[0],b[0],c[0])));
    const top=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),bottom=Math.min(height-1,Math.ceil(Math.max(a[1],b[1],c[1])));
    const shade=.55+.6*Math.max(0,dot(vertices[t].n,light));
    const color=vertices[t].c.map(v=>srgb(v*shade));
    for(let y=top;y<=bottom;y++)for(let x=left;x<=rightEdge;x++){
      const u=((b[0]-x)*(c[1]-y)-(b[1]-y)*(c[0]-x))/area;
      const v=((c[0]-x)*(a[1]-y)-(c[1]-y)*(a[0]-x))/area,w=1-u-v;
      if(u<0||v<0||w<0)continue;
      const z=u*a[2]+v*b[2]+w*c[2],at=y*width+x;if(z<=depth[at])continue;depth[at]=z;preview.data.set([...color,255],at*4);
    }
  }
  await writeMinWebp(`${directory}/${source.id}.preview.webp`,PNG.sync.write(preview));
  const category=source.category;let scaleFactor;
  if(Number.isFinite(source.unitScale)&&source.unitScale>0)scaleFactor=source.unitScale;
  else if(category.startsWith('植被'))scaleFactor=4/size[1];
  else if(category.startsWith('地表'))scaleFactor=6/Math.max(size[0],size[2]);
  else if(category.startsWith('GIS'))scaleFactor=34/Math.max(size[0],size[2]);
  else if(category.startsWith('交通'))scaleFactor=4/Math.max(...size);
  else if(category.startsWith('道路'))scaleFactor=(source.id==='streetlight'?5:6)/Math.max(...size);
  else if(category==='建筑 / 公共建筑')scaleFactor=10/size[1];
  else scaleFactor=(category.startsWith('建筑')?10:5)/Math.max(...size);
  const catalogSource={...source};delete catalogSource.orientation;
  return {...catalogSource,thumbnail:`/models/${source.id}.preview.webp`,mesh:`/models/${source.id}.mesh`,glb:`model-sources/${source.id}.glb`,size:size.map(v=>Number((v*scaleFactor).toFixed(3))),triangles:vertices.length/3};
}
const selectedIds=new Set(process.argv.slice(2));
const catalog=selectedIds.size
  ? JSON.parse(await readFile(`${directory}/catalog.json`,'utf8'))
  : [];
for(const source of sources){
  if(selectedIds.size&&!selectedIds.has(source.id))continue;
  const asset=await prepare(source);
  if(selectedIds.size){
    const index=catalog.findIndex(item=>item.id===source.id);
    if(index<0)throw Error(`${source.id}: missing from generated catalog`);
    catalog[index]=asset;
  }else catalog.push(asset);
  process.stdout.write(`Prepared ${source.id}\n`);
}
for(const id of selectedIds)if(!sources.some(source=>source.id===id))throw Error(`Unknown model: ${id}`);
await writeFile(`${directory}/catalog.json`,JSON.stringify(catalog,null,2));
await mkdir(new URL('../src/data/',import.meta.url),{recursive:true});
// 不在素材面板展示、仅供内置场景模板引用的模型。Kenney 卡通系已全部下架（2026-11-08），
// 这 42 个是模板仍在依赖的最小集合：智慧园区/参考园区/城市/管道/地表样板。删除前需先重做模板。
const panelHiddenModelIds=[
  'office','office-low','tower','tower-glass','industrial-a','industrial-c','industrial-j',
  'chimney','tank','conveyor','crane','pipe','pipe-bend','valve',
  'ambulance','car','firetruck','truck','tree','oak','pine','bush',
  'road','road-junction','streetlight',
  'terrain-grass','terrain-path-bend','terrain-path-corner','terrain-path-cross','terrain-path-end',
  'terrain-path-rocks','terrain-path-split','terrain-path-straight','terrain-path-tile',
  'terrain-river-bend','terrain-river-corner','terrain-river-cross','terrain-river-end',
  'terrain-river-rocks','terrain-river-split','terrain-river-straight','terrain-river-tile',
];
await writeFile(output,`// Generated from attributed local GLB sources by scripts/prepare-models.mjs.\nexport interface ModelAsset { id: string; name: string; category: string; author: string; license: string; source: string; download: string; pack: string; thumbnail: string; mesh: string; glb: string; size: number[]; triangles: number; unitScale?: number; aiGenerated?: boolean; }\nexport const modelAssets: ModelAsset[] = ${JSON.stringify(catalog,null,2)};\nexport const modelAssetById = new Map(modelAssets.map(asset => [asset.id, asset]));\nexport const panelHiddenModelIds: string[] = ${JSON.stringify(panelHiddenModelIds)};\n`);
