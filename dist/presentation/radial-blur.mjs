/** Native shaders/radialblur.fsh, JHRadialBlur and JHBlurIn/Out.
 * point uses top-left Canvas normalized coordinates; the GLSL adapter flips y.
 * CPU reference uses the same nine taps with linear/clamp-to-edge texture sampling.
 */
export const RADIAL_SAMPLES=Object.freeze([.01,.03,.04,.06,-.06,-.04,-.03,-.01]);
export const RADIAL_FRAGMENT=`precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D CC_Texture0;
uniform float u_Dist;
uniform float u_Strength;
uniform vec2 u_BlurPoint;
void main(){
 float samples[8];samples[0]=0.01;samples[1]=0.03;samples[2]=0.04;samples[3]=0.06;samples[4]=-0.06;samples[5]=-0.04;samples[6]=-0.03;samples[7]=-0.01;
 vec2 dir=u_BlurPoint-v_texCoord;float dist=length(dir);dir/=dist;
 vec4 color=texture2D(CC_Texture0,v_texCoord);vec4 sum=color;
 for(int i=0;i<8;i++){sum+=texture2D(CC_Texture0,v_texCoord+dir*samples[i]*u_Dist);}
 sum/=9.0;float t=clamp(dist*u_Strength,0.0,1.0);gl_FragColor=mix(color,sum,t);
}`;
export function originalBlurDistance(ageMs,{timeSpeed=1,initialDist=0}={}){
 const hold=300*timeSpeed,end=100+hold;
 if(ageMs<0||ageMs>=end)return null;
 if(ageMs<50)return initialDist+(2-initialDist)*ageMs/50;
 if(ageMs<50+hold)return 2;
 return 2*(1-(ageMs-50-hold)/50);
}
export function radialBlurPixels(source,width,height,{point,dist,strength=3},target=new Uint8ClampedArray(source.length)){
 const clamp=(v,max)=>Math.max(0,Math.min(max,v)),wmax=width-1,hmax=height-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const index=(y*width+x)*4,u=(x+.5)/width,v=(y+.5)/height,dx=point.x-u,dy=point.y-v,length=Math.hypot(dx,dy),mix=Math.min(1,length*strength);
  if(!length||!dist){for(let c=0;c<4;c++)target[index+c]=source[index+c];continue;}
  const stepx=dx/length*dist*width,stepy=dy/length*dist*height;let r=source[index],g=source[index+1],b=source[index+2],a=source[index+3];
  for(const sample of RADIAL_SAMPLES){const sx=clamp(x+stepx*sample,wmax),sy=clamp(y+stepy*sample,hmax),ix=Math.floor(sx),iy=Math.floor(sy),jx=Math.min(ix+1,wmax),jy=Math.min(iy+1,hmax),fx=sx-ix,fy=sy-iy,w00=(1-fx)*(1-fy),w10=fx*(1-fy),w01=(1-fx)*fy,w11=fx*fy,i00=(iy*width+ix)*4,i10=(iy*width+jx)*4,i01=(jy*width+ix)*4,i11=(jy*width+jx)*4;
   r+=source[i00]*w00+source[i10]*w10+source[i01]*w01+source[i11]*w11;g+=source[i00+1]*w00+source[i10+1]*w10+source[i01+1]*w01+source[i11+1]*w11;b+=source[i00+2]*w00+source[i10+2]*w10+source[i01+2]*w01+source[i11+2]*w11;a+=source[i00+3]*w00+source[i10+3]*w10+source[i01+3]*w01+source[i11+3]*w11;
  }
  target[index]=source[index]+(r/9-source[index])*mix;target[index+1]=source[index+1]+(g/9-source[index+1])*mix;target[index+2]=source[index+2]+(b/9-source[index+2])*mix;target[index+3]=source[index+3]+(a/9-source[index+3])*mix;
 }
 return target;
}
export function createRadialBlurRenderer({makeCanvas,preferGPU=true}={}){
 let gpu=null,attempted=false;
 function createGPU(width,height){let surface;if(makeCanvas)surface=makeCanvas(width,height);else if(typeof OffscreenCanvas!=='undefined')surface=new OffscreenCanvas(width,height);else if(typeof document!=='undefined'){surface=document.createElement('canvas');surface.width=width;surface.height=height;}if(!surface)return null;
  let gl;try{gl=surface.getContext('webgl',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});}catch{return null;}if(!gl)return null;
  function shader(type,source){const result=gl.createShader(type);gl.shaderSource(result,source);gl.compileShader(result);if(!gl.getShaderParameter(result,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(result));return result;}
  const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 a_position;varying vec2 v_texCoord;void main(){v_texCoord=(a_position+1.0)*0.5;gl_Position=vec4(a_position,0.0,1.0);}'));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,RADIAL_FRAGMENT));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const location=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
  const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.uniform1i(gl.getUniformLocation(program,'CC_Texture0'),0);return{surface,gl,program,texture,dist:gl.getUniformLocation(program,'u_Dist'),strength:gl.getUniformLocation(program,'u_Strength'),point:gl.getUniformLocation(program,'u_BlurPoint')};
 }
 return {apply(ctx,parameters){if(!parameters||parameters.dist===null||parameters.dist===0)return;const {width,height}=ctx.canvas;
  if(preferGPU&&!attempted){attempted=true;gpu=createGPU(width,height);}
  if(gpu){const {gl,surface}=gpu;if(surface.width!==width)surface.width=width;if(surface.height!==height)surface.height=height;gl.viewport(0,0,width,height);gl.useProgram(gpu.program);gl.bindTexture(gl.TEXTURE_2D,gpu.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,ctx.canvas);gl.uniform1f(gpu.dist,parameters.dist);gl.uniform1f(gpu.strength,parameters.strength??3);gl.uniform2f(gpu.point,parameters.point.x,1-parameters.point.y);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.drawImage(surface,0,0,width,height);ctx.restore();return;}
  const pixels=ctx.getImageData(0,0,width,height),result=ctx.createImageData(width,height);radialBlurPixels(pixels.data,width,height,parameters,result.data);ctx.putImageData(result,0,0);
 },get mode(){return gpu?'original-glsl':'cpu-reference';}};
}
