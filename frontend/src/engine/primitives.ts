import { meshNode } from "./importGlb";
export type PrimitiveKind="sphere"|"cylinder"|"cone"|"torus";
export const primitiveLabels:Record<PrimitiveKind,string>={sphere:"球体",cylinder:"圆柱体",cone:"圆锥体",torus:"圆环体"};
export function primitiveNode(kind:PrimitiveKind){
  const vertices:number[]=[],segments=24,stacks=kind==="sphere"?16:kind==="torus"?12:1;
  const p=(u:number,v:number):number[]=>{const a=u*Math.PI*2,b=v*Math.PI*2;
    if(kind==="sphere")return[Math.sin(v*Math.PI)*Math.cos(a)*.5,Math.cos(v*Math.PI)*.5,Math.sin(v*Math.PI)*Math.sin(a)*.5];
    if(kind==="torus")return[(.35+.15*Math.cos(b))*Math.cos(a),.15*Math.sin(b),(.35+.15*Math.cos(b))*Math.sin(a)];
    const radius=kind==="cone"?.5*(1-v):.5;return[Math.cos(a)*radius,v-.5,Math.sin(a)*radius];
  };
  const triangle=(a:number[],b:number[],c:number[])=>{if(kind!=="sphere")[b,c]=[c,b];const e=b.map((v,i)=>v-a[i]),f=c.map((v,i)=>v-a[i]),n=[e[1]*f[2]-e[2]*f[1],e[2]*f[0]-e[0]*f[2],e[0]*f[1]-e[1]*f[0]],length=Math.hypot(...n);if(length<1e-8)return;for(const point of[a,b,c])vertices.push(...point,...n.map(v=>v/length),.7,.76,.85)};
  for(let i=0;i<segments;i++)for(let j=0;j<stacks;j++){const a=p(i/segments,j/stacks),b=p((i+1)/segments,j/stacks),c=p((i+1)/segments,(j+1)/stacks),d=p(i/segments,(j+1)/stacks);triangle(a,b,c);triangle(a,c,d)}
  if(kind==="cylinder"||kind==="cone")for(let i=0;i<segments;i++){triangle([0,-.5,0],p((i+1)/segments,0),p(i/segments,0));if(kind==="cylinder")triangle([0,.5,0],p(i/segments,1),p((i+1)/segments,1))}
  return meshNode(primitiveLabels[kind],vertices,kind==="torus"?[4,1.2,4]:[4,4,4]);
}
