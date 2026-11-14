import { useRef } from "react";
import { transformedTree } from "../data/editor";
import { getState, setState, useStore } from "../state/store";
import { flattenScene } from "../workers/sceneModel";
import { getSceneBridge } from "../workers/bridge";
import type { SceneNode } from "../types";
import { selection } from "../state/sceneActions";
export interface HandleProjection { origin: number[]; axes: number[][]; }
export default function TransformHandles({projection}:{projection:HandleProjection|null}) {
  const state=useStore();
  const drag=useRef<{x:number;y:number;axis:number;nodes:SceneNode[];ids:string[];delta:number[];direction:number[];length:number;tool:"position"|"rotation"|"scale"}|null>(null);
  if(!projection||!selection().length)return null;
  const [x,y]=projection.origin, colors=["#f0786d","#8bce6b","#6cafff"];
  const start=(event:React.PointerEvent,axis:number)=>{event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);
    const direction=projection.axes[axis].map((v,i)=>v-projection.origin[i]),length=Math.hypot(...direction)||1;
    drag.current={x:event.clientX,y:event.clientY,axis,nodes:structuredClone(getState().scene),ids:selection(),delta:state.tool==="scale"?[1,1,1]:[0,0,0],direction:direction.map(v=>v/length),length,tool:state.tool==="move"?"position":state.tool==="rotate"?"rotation":"scale"};
  };
  const move=(event:React.PointerEvent)=>{const d=drag.current;if(!d)return;const dx=event.clientX-d.x,dy=event.clientY-d.y;
    let value=d.tool==="position"?(dx*d.direction[0]+dy*d.direction[1])/Math.max(.2,d.length):d.tool==="rotation"?(dx-dy)*.6:Math.exp((dx-dy)*.01);
    const snap=getState().snap;if(snap&&d.tool!=="scale")value=Math.round(value/(d.tool==="rotation"?15:snap))*(d.tool==="rotation"?15:snap);
    d.delta[d.axis]=value;setState({flat:flattenScene(transformedTree(d.nodes,d.ids,d.tool,d.delta))});
  };
  const end=()=>{const d=drag.current;if(!d)return;drag.current=null;const identity=d.tool==="scale"?1:0;if(d.delta.some(v=>Math.abs(v-identity)>.00001))getSceneBridge().post({type:"transformSelection",ids:d.ids,property:d.tool,delta:d.delta});else setState({flat:flattenScene(getState().scene)});};
  return <svg className="transform-handles" aria-label="三维变换轴" onPointerMove={move} onPointerUp={end} onPointerCancel={()=>{drag.current=null;setState({flat:flattenScene(getState().scene)})}}>
    {projection.axes.map((p,i)=>{const delta=[p[0]-x,p[1]-y],length=Math.hypot(...delta)||1,end=[x+delta[0]/length*66,y+delta[1]/length*66];return <g key={i} className="transform-axis" onPointerDown={e=>start(e,i)} role="button" aria-label={`${["移动","旋转","缩放"][["move","rotate","scale"].indexOf(state.tool)]}${["X","Y","Z"][i]}轴`}>
      <line x1={x} y1={y} x2={end[0]} y2={end[1]} stroke="transparent" strokeWidth="18"/>
      <line x1={x} y1={y} x2={end[0]} y2={end[1]} stroke={colors[i]} strokeWidth="3"/>
      {state.tool==="scale"?<rect x={end[0]-5} y={end[1]-5} width="10" height="10" fill={colors[i]}/>:<circle cx={end[0]} cy={end[1]} r={state.tool==="rotate"?7:5} fill={state.tool==="rotate"?"#162337":colors[i]} stroke={colors[i]} strokeWidth="2"/>}
      <text x={end[0]+8} y={end[1]-7} fill={colors[i]} fontSize="11">{["X","Y","Z"][i]}</text>
    </g>})}<circle cx={x} cy={y} r="4" fill="#fff"/>
  </svg>;
}
