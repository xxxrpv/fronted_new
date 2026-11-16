import type { WebGLRenderer, Object3D, Scene, PerspectiveCamera } from 'three';
export class SensorRenderer {
  constructor(renderer:WebGLRenderer,options?:{getTemperature?:(object:Object3D)=>number});
  width:number;
  height:number;
  pointCount:number;
  resize(width:number,height:number,pixelRatio?:number):void;
  render(scene:Scene,camera:PerspectiveCamera,options?:{mode?:'rgb'|'thermal'|'depth'|'pointcloud';comparison?:boolean}):void;
  getLegend(mode:string,camera:PerspectiveCamera):{title:string;description:string;unit:string;min?:number;max?:number;colors:string[];samples?:number;synthetic:true;sameCamera:true;resolution:string};
  dispose():void;
}
export default SensorRenderer;
