/** Known-answer regressions for D26 local crowd movement.
 * Run with vite-node, or bundle for a GPU-free Node check.
 * Dense-cell queries are compared to brute force; movement uses initially clear
 * bodies and actual emitted solid descriptors. Counts never certify identity.
 */
import { CrowdSim } from './crowd';
import { defaultWorld } from '../core/state';
import { City, cityPlan, defaultCityConfig, GROUND_Y, sampleStreetPlan, type StreetSample } from '../world/citygen';
import { bakeChunk, INSTANCE_FLOATS } from '../render/citymesh';
import { pedestrianMesh } from '../render/pedestrianmesh';
import { PEDESTRIAN_RADIUS, PEDESTRIAN_HEIGHT, type CrowdObstacle } from '../world/crowdobstacles';
import { WalkingSurfaceIndex, WalkingSurfaceSet, WALKING_TRIANGLE_FLOATS, walkingTriangles } from '../world/walkingsurfaces';
import { decodeGroundSurfaceTag } from '../world/groundgrammar';
import type { Mesh } from '../world/geometry';

const STRIDE = 29, ACTIVE = 25;
const BODY_SEPARATION = PEDESTRIAN_RADIUS * 2;
interface Grid {
  configure(centre: [number,number,number],radius:number):void;
  build(f:Float32Array,ids:Int32Array,n:number):void;
  nearest(x:number,z:number,r:number,out:Int32Array,max:number,ignore?:number):number;
  move(i:number,x:number,z:number):void;
}
interface RawCrowd {
  f:Float32Array; grid:Grid;
  writeInstance(n:number,o:number):void;
  nodes:{position:[number,number,number]}[];
  densitySeen:number; targetVisible:number; viewRadius:number;
}
const failures:string[]=[];
function check(ok:boolean,why:string):void { if(!ok&&!failures.includes(why)) failures.push(why); }
function raw(c:CrowdSim):RawCrowd { return c as unknown as RawCrowd; }

function queryProperties():void {
  const grid=raw(new CrowdSim(1)).grid;
  const count=1200,f=new Float32Array(count*STRIDE),ids=new Int32Array(count);
  for(let i=0;i<count;i++) {
    ids[i]=i;
    // The closest bodies have the highest storage IDs, beyond every old cap.
    f[i*STRIDE]=0.8-i*0.0005;
    f[i*STRIDE+2]=0.2+(i%7)*0.001;
    f[i*STRIDE+ACTIVE]=1;
  }
  f[17*STRIDE+ACTIVE]=0;
  f[1197*STRIDE]=f[1198*STRIDE]; f[1197*STRIDE+2]=f[1198*STRIDE+2];
  const out=new Int32Array(32);
  const expected=Array.from(ids).filter(i=>f[i*STRIDE+ACTIVE]>.5&&i!==1199)
    .map(i=>({i,d:f[i*STRIDE]**2+f[i*STRIDE+2]**2}))
    .filter(p=>p.d<=1).sort((a,b)=>a.d-b.d||a.i-b.i).slice(0,out.length).map(p=>p.i);
  let reference='';
  for(let permutation=0;permutation<3;permutation++) {
    for(let k=0;k<count;k++) ids[k]=permutation===0?k:permutation===1?count-1-k:(k*397)%count;
    grid.configure([0,0,0],4);grid.build(f,ids,count);
    const n=grid.nearest(0,0,1,out,out.length,1199);
    const got=Array.from(out.subarray(0,n));
    check(got.join(',')===expected.join(','),`closest set differs from brute force for dense cell permutation ${permutation}: ${got.slice(0,3)} vs ${expected.slice(0,3)}`);
    check(new Set(got).size===got.length&&!got.includes(1199)&&!got.includes(17),'nearest includes duplicate, self or inactive body');
    if(permutation===0)reference=got.join(',');else check(got.join(',')===reference,'query depends on cell insertion order');
  }
  // Membership changes are visible without another full grid rebuild.
  f[0]=-.01;f[2]=-.01;grid.move(0,f[0],f[2]);
  const n=grid.nearest(-.01,-.01,.05,out,32);
  check(n===1&&out[0]===0,'moving across a negative-coordinate cell boundary leaves stale membership');
}

function fixture(points:readonly (readonly [number,number,number,number])[]):{sim:CrowdSim;state:RawCrowd;world:ReturnType<typeof defaultWorld>;camera:{position:[number,number,number];lookAt:[number,number,number]}} {
  const sim=new CrowdSim(19),state=raw(sim),world=defaultWorld(19);
  world.crowds.density=0;world.weather.windSpeed=0;
  state.densitySeen=0;state.targetVisible=0;state.viewRadius=80;
  state.nodes=points.map(p=>({position:[p[2],GROUND_Y,p[3]]}));
  points.forEach((p,i)=>{
    const o=i*STRIDE,f=state.f;
    f[o]=p[0];f[o+1]=GROUND_Y;f[o+2]=p[1];
    f[o+8]=i;f[o+9]=i;f[o+13]=1.4;f[o+19]=i*.173;f[o+20]=120;f[o+ACTIVE]=1;
  });
  const cx=points.reduce((sum,p)=>sum+p[0],0)/points.length;
  const cz=points.reduce((sum,p)=>sum+p[1],0)/points.length;
  const camera={position:[cx-40,2,cz] as [number,number,number],lookAt:[cx+40,2,cz] as [number,number,number]};
  return {sim,state,world,camera};
}

/** Independent geometric minimum while both pre/post segments advance together. */
function relativeFrameClearance(before:Float32Array,after:Float32Array,n:number,scenario:string):void {
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++) {
    const a=i*STRIDE,b=j*STRIDE;
    const px=before[a]-before[b],pz=before[a+2]-before[b+2];
    const vx=after[a]-after[b]-px,vz=after[a+2]-after[b+2]-pz;
    const v2=vx*vx+vz*vz;
    const t=v2>0?Math.max(0,Math.min(1,-(px*vx+pz*vz)/v2)):0;
    const nearest=Math.hypot(px+vx*t,pz+vz*t);
    check(nearest>=BODY_SEPARATION-1e-5,`${scenario} simultaneous paths overlap between frames: ${nearest}m`);
  }
}

function motionProperties():void {
  for(const dt of [1/120,1/60,1/15,1]) {
    for(const crossing of [false,true]) {
      const points: [number,number,number,number][]=crossing
        ? [[-1,0,10,0],[0,-1,0,10],[4,4,9,4]]
        : [[-.3,0,10,0],[.3,0,-10,0],[4,4,9,4]];
      const {sim,state,world,camera}=fixture(points);
      let min=Infinity;
      for(let frame=0;frame<180;frame++) {
        const before=state.f.slice(0,points.length*STRIDE);
        sim.update(dt,camera,world);
        check(points.every((_,i)=>state.f[i*STRIDE+ACTIVE]>.5),'collision fixture retired a measured body');
        relativeFrameClearance(before,state.f,points.length,`${crossing?'crossing':'head-on'} dt=${dt}`);
        for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++) {
          min=Math.min(min,Math.hypot(state.f[i*STRIDE]-state.f[j*STRIDE],state.f[i*STRIDE+2]-state.f[j*STRIDE+2]));
        }
      }
      check(min>=BODY_SEPARATION-1e-5,`${crossing?'crossing':'head-on'} bodies overlap at dt=${dt}: ${min}m`);
      check(Math.hypot(state.f[2*STRIDE]-4,state.f[2*STRIDE+2]-4)>.25,`unobstructed body does not travel at dt=${dt}`);
    }
  }
  const {sim,state,world}=fixture([[-1,0,10,0],[1,0,-10,0]]);
  const before=state.f.slice();sim.update(0,{position:[-40,2,0]},world);
  check(state.f[0]===before[0]&&state.f[2]===before[2]&&state.f[STRIDE]===before[STRIDE]&&state.f[STRIDE+2]===before[STRIDE+2],'dt=0 moves body positions');

  // Large external displacement can cross a whole body within the clamped dt.
  const gust=fixture([[-.6,0,10,0],[.1,0,-10,0]]);
  gust.world.weather.windSpeed=200;
  gust.world.weather.windDir=0;
  for(let frame=0;frame<3;frame++) {
    const before=gust.state.f.slice(0,2*STRIDE);
    gust.sim.update(1,gust.camera,gust.world);
    check(gust.state.f[ACTIVE]>.5&&gust.state.f[STRIDE+ACTIVE]>.5,'gust fixture retired a measured body');
    check(Math.hypot(gust.state.f[0]-gust.state.f[STRIDE],gust.state.f[2]-gust.state.f[STRIDE+2])>=BODY_SEPARATION-1e-5,'large external displacement tunnels through another body');
    relativeFrameClearance(before,gust.state.f,2,'large external gust');
  }
}

function obstacleProperties(obstacle:CrowdObstacle):void {
  // Derive both the diagnostic and the approach from the actual emitted solid.
  const clearance=obstacle.halfAlong+PEDESTRIAN_RADIUS+.2;
  const point=(along:number,across:number):[number,number]=>[
    obstacle.x+obstacle.tx*along-obstacle.tz*across,
    obstacle.z+obstacle.tz*along+obstacle.tx*across,
  ];
  const start=point(-clearance,0), goal=point(clearance*3,0);
  const freeStart=point(-clearance,obstacle.halfAcross+1);
  const freeGoal=point(clearance*3,obstacle.halfAcross+1);
  const points:[number,number,number,number][]=[
    [...start,...goal], [...freeStart,...freeGoal],
  ];
  const {sim,state,world,camera}=fixture(points);
  sim.setStaticObstacles([obstacle],1);
  let moved=0;
  for(let frame=0;frame<120;frame++) {
    sim.update(1/15,camera,world);
    for(let i=0;i<points.length;i++) {
      check(state.f[i*STRIDE+ACTIVE]>.5,'emitted-solid fixture retired a measured body');
      const rx=state.f[i*STRIDE]-obstacle.x,rz=state.f[i*STRIDE+2]-obstacle.z;
      const along=rx*obstacle.tx+rz*obstacle.tz,across=-rx*obstacle.tz+rz*obstacle.tx;
      const edgeDistance=Math.hypot(Math.max(0,Math.abs(along)-obstacle.halfAlong),Math.max(0,Math.abs(across)-obstacle.halfAcross));
      check(edgeDistance>=PEDESTRIAN_RADIUS-1e-5,`body overlaps emitted ${obstacle.kind}`);
      if(i===0)check(along<=-obstacle.halfAlong-PEDESTRIAN_RADIUS+1e-4,`body tunnels through emitted ${obstacle.kind}`);
      const previous=points[i];
      moved=Math.max(moved,Math.hypot(state.f[i*STRIDE]-previous[0],state.f[i*STRIDE+2]-previous[1]));
    }
  }
  check(moved>.25,`bodies remain pinned beside emitted ${obstacle.kind}`);
}

function lateSolidRevision(obstacle:CrowdObstacle):void {
  const {sim,state,world,camera}=fixture([
    [obstacle.x,obstacle.z,obstacle.x+obstacle.tx*10,obstacle.z+obstacle.tz*10],
  ]);
  sim.setStaticObstacles([],1);
  sim.update(0,camera,world);
  // The body is already present when a later visual detail revision arrives.
  sim.setStaticObstacles([obstacle],2);
  let previousX=state.f[0],previousZ=state.f[2],recoveryFrames=0;
  for(let frame=0;frame<120;frame++) {
    sim.update(1/60,camera,world);
    check(state.f[ACTIVE]>.5,'late-solid fixture retired the measured body');
    if(sim.diag.obstacleRecoveries>0) {
      recoveryFrames++;
      check(Math.hypot(state.f[0]-previousX,state.f[2]-previousZ)<=1.4/60+1e-4,'late solid recovery teleports beyond pace times dt');
    }
    previousX=state.f[0];previousZ=state.f[2];
  }
  const rx=state.f[0]-obstacle.x,rz=state.f[2]-obstacle.z;
  const along=Math.abs(rx*obstacle.tx+rz*obstacle.tz),across=Math.abs(-rx*obstacle.tz+rz*obstacle.tx);
  check(Math.hypot(Math.max(0,along-obstacle.halfAlong),Math.max(0,across-obstacle.halfAcross))>=PEDESTRIAN_RADIUS-1e-5,'body remains inside newly streamed emitted solid after bounded recovery');
  check(recoveryFrames>0,'late-solid fixture never exercised local recovery');
}

function emittedSolids():Mesh {
  const seed=0x5e7a17,city=new City(defaultCityConfig(seed));
  const chunk=city.getChunk(0,-2);
  if(!chunk)throw new Error('emitted-solid fixture chunk is not resident');
  const baked=bakeChunk(chunk,0,seed);
  const counter=baked.obstacles.find(b=>b.kind==='market-counter');
  const furniture=baked.obstacles.find(b=>b.kind!=='building'&&!b.kind.startsWith('market-')&&!b.kind.startsWith('prop-')&&b.maxY>GROUND_Y+.2);
  check(!!counter,'near-hero emitter produced no counter for collision fixture');
  check(!!furniture,'near-hero emitter produced no street furniture for collision fixture');
  if(counter) { obstacleProperties(counter); lateSolidRevision(counter); }
  if(furniture)obstacleProperties(furniture);
  console.log(`  emitted solids tested: ${counter?.kind??'MISSING'}, ${furniture?.kind??'MISSING'} from chunk(${chunk.cx},${chunk.cz})`);
  return baked.opaque;
}

function walkingSurfaceProperties(mesh:Mesh):void {
  const index=new WalkingSurfaceIndex();
  // A sloped upward triangle spans negative cells, zero and exact8m boundaries.
  const up=new Float32Array([-8,.5,-8, -8,.7,8, 8,.9,-8]);
  index.set(up,1);
  check(Math.abs(index.heightAt(-4,-4,GROUND_Y)-.65)<1e-6,'walking support does not interpolate the actual triangle plane');
  for(const p of [[-8,-8,.5],[8,-8,.9],[-8,8,.7],[0,0,.8]]) {
    check(Math.abs(index.heightAt(p[0],p[1],GROUND_Y)-p[2])<1e-6,'walking triangle loses a vertex/edge at a cell boundary');
  }
  check(index.heightAt(7,7,GROUND_Y)===GROUND_Y&&index.heightAt(40,-40,GROUND_Y)===GROUND_Y,'walking triangle bbox or missing cell replaces deck outside its footprint');
  const down=new Float32Array([-8,2,-8, 8,2,-8, -8,2,8]);
  index.set(down,2);
  check(index.heightAt(-4,-4,GROUND_Y)===GROUND_Y,'downward-wound face becomes walking support');
  const high=up.slice();for(let k=1;k<high.length;k+=3)high[k]+=.25;
  const permutations=[new Float32Array([...up,...high,...down]),new Float32Array([...down,...high,...up])];
  for(let k=0;k<permutations.length;k++) {
    index.set(permutations[k],3+k);
    check(Math.abs(index.heightAt(-4,-4,GROUND_Y)-.9)<1e-6,'overlapping walking surfaces do not select highest actual upward support');
  }
  index.set(new Float32Array(0),4);
  check(Math.abs(index.heightAt(-4,-4,GROUND_Y)-.9)<1e-6,'same walking revision accepts a changed buffer');
  index.set(new Float32Array(0),5);
  check(index.heightAt(-4,-4,GROUND_Y)===GROUND_Y,'new empty walking revision leaves stale support');

  // Extract directly from the actual opaque mesh, independently of the future
  // production extractor. Authored normals alone cannot admit a backface.
  const vertices:number[]=[];
  const point:[number,number]=[114.277099609375,-416.1273193359375];
  let expected=GROUND_Y;
  function contains(t:readonly number[],x:number,z:number):boolean {
    for(let edge=0;edge<3;edge++) {
      const a=edge*3,b=((edge+1)%3)*3;
      if((t[b]-t[a])*(z-t[a+2])-(t[b+2]-t[a+2])*(x-t[a])>1e-7)return false;
    }
    return true;
  }
  for(let i=0;i<mesh.indices.length;i+=3) {
    const ids=[mesh.indices[i],mesh.indices[i+1],mesh.indices[i+2]];
    const tag=mesh.colors[ids[0]*4+3];if(tag>=0)continue;
    const kind=decodeGroundSurfaceTag(tag).surface;
    if(kind!=='paving'&&kind!=='kerb-top')continue;
    const t=ids.flatMap(v=>Array.from(mesh.positions.subarray(v*3,v*3+3)));
    const area=(t[3]-t[0])*(t[8]-t[2])-(t[5]-t[2])*(t[6]-t[0]);
    if(area>=-1e-10)continue;
    vertices.push(...t);
    if(contains(t,...point)) {
      check(t[1]===t[4]&&t[4]===t[7],'known hero walking fixture is no longer a horizontal emitted patch');
      expected=Math.max(expected,t[1]);
    }
  }
  check(expected>GROUND_Y+.03,'actual hero point has no upward raised walking triangle');
  const actual=new Float32Array(vertices);
  check(actual.length%WALKING_TRIANGLE_FLOATS===0,'walking extraction breaks the compact triangle contract');
  index.set(actual,6);
  check(Math.abs(index.heightAt(...point,GROUND_Y)-expected)<1e-6,'known hero point is below its actual emitted support');
  const production=new WalkingSurfaceIndex();
  production.set(walkingTriangles(mesh),1);
  check(Math.abs(production.heightAt(...point,GROUND_Y)-expected)<1e-6,'production walking extractor disagrees with the independent extraction');
  // Per-chunk set: any split of the same triangles answers exactly like one index.
  const all=walkingTriangles(mesh),cut=Math.floor(all.length/18)*9;
  const a=all.slice(0,cut),b=all.slice(cut),set=new WalkingSurfaceSet();
  check(set.update(new Map([['a',a],['b',b]])),'walking set did not accept its first parts');
  check(!set.update(new Map([['a',a],['b',b]])),'walking set rebuilt unchanged parts');
  let mismatch=0;
  for(let k=0;k<2000;k++){
    const x=point[0]-60+((k*7919)%1000)/1000*120,z=point[1]-60+((k*104729)%1000)/1000*120;
    if(Math.abs(set.heightAt(x,z,GROUND_Y)-production.heightAt(x,z,GROUND_Y))>1e-6)mismatch++;
  }
  check(mismatch===0,`per-chunk walking set disagrees with one index at ${mismatch} of 2000 points`);

  const points:[number,number,number,number][]=[
    [point[0],point[1],point[0]+12,point[1]],
    [point[0]+2,point[1],point[0]+14,point[1]],
  ];
  const grounded=fixture(points),flat=fixture(points);
  grounded.sim.setWalkingSurfaces(actual,1);
  check(grounded.state.f[1]===Math.fround(GROUND_Y),'walking setter changes held actors before simulation update');
  grounded.sim.update(0,grounded.camera,grounded.world);
  flat.sim.update(0,flat.camera,flat.world);
  check(Math.abs(grounded.state.f[1]-expected)<1e-6,'existing hero body does not acquire emitted support on update');
  check(grounded.sim.instances.data[13]===grounded.state.f[1],'grounded instance transform retains the old deck height');
  for(let frame=0;frame<90;frame++) {
    grounded.sim.update(1/60,grounded.camera,grounded.world);
    flat.sim.update(1/60,flat.camera,flat.world);
    for(let i=0;i<points.length;i++) {
      const o=i*STRIDE;
      check(grounded.state.f[o+ACTIVE]>.5,'grounding fixture retired a measured body');
      check(grounded.state.f[o]===flat.state.f[o]&&grounded.state.f[o+2]===flat.state.f[o+2],'walking support changes horizontal travel');
      let support=GROUND_Y;
      for(let k=0;k<vertices.length;k+=WALKING_TRIANGLE_FLOATS) {
        const t=vertices.slice(k,k+WALKING_TRIANGLE_FLOATS);
        if(contains(t,grounded.state.f[o],grounded.state.f[o+2]))support=Math.max(support,t[1]);
      }
      check(Math.abs(grounded.state.f[o+1]-support)<1e-6,'moving body leaves actual emitted support height');
    }
    check(Math.hypot(grounded.state.f[0]-grounded.state.f[STRIDE],grounded.state.f[2]-grounded.state.f[STRIDE+2])>=BODY_SEPARATION-1e-5,'grounding breaks body clearance');
  }
  check(Math.hypot(grounded.state.f[0]-point[0],grounded.state.f[2]-point[1])>.25,'grounded hero body stays pinned');
  const changed=fixture([points[0]]);
  changed.sim.setWalkingSurfaces(actual,1);changed.sim.update(0,changed.camera,changed.world);
  const lifted=actual.slice();for(let i=1;i<lifted.length;i+=3)lifted[i]+=.04;
  changed.sim.setWalkingSurfaces(lifted,2);
  const prior=changed.state.f[1],priorX=changed.state.f[0],priorZ=changed.state.f[2];
  changed.sim.update(0,changed.camera,changed.world);
  check(Math.abs(changed.state.f[1]-prior-.04)<1e-6,'walking revision does not update an existing body height');
  check(changed.state.f[0]===priorX&&changed.state.f[2]===priorZ,'walking revision teleports body horizontally');
  changed.sim.setWalkingSurfaces(new Float32Array(0),3);
  changed.sim.update(0,changed.camera,changed.world);
  check(Math.abs(changed.state.f[1]-GROUND_Y)<1e-6,'removed walking revision does not restore deck fallback');
  console.log(`  actual hero walking support ${expected.toFixed(6)}m; old foot origin ${GROUND_Y}m; horizontal travel preserved`);
}

function meshEnvelope():void {
  const mesh=pedestrianMesh();
  let leftSupport=false,rightSupport=false,centralSupport=false;
  let maxRadius=0;
  for(let p=0;p<mesh.positions.length;p+=3) {
    const x=mesh.positions[p],y=mesh.positions[p+1],z=mesh.positions[p+2];
    maxRadius=Math.max(maxRadius,Math.hypot(x,z));
    check(y>=-1e-6&&y<=PEDESTRIAN_HEIGHT+1e-6,'human vertex leaves shared height envelope');
    for(let k=0;k<16;k++) {
      const a=k*Math.PI/8,c=Math.cos(a),t=Math.sin(a);
      check(Math.hypot(x*c+z*t,-x*t+z*c)<=PEDESTRIAN_RADIUS+1e-7,'human geometry leaves collision disc at yaw');
    }
  }
  // Intersect actual triangles at shin height: two supports with an open
  // center, rather than a single post whose name claims that it is two legs.
  const cut=.4;
  for(let tri=0;tri<mesh.indices.length;tri+=3) {
    const xs:number[]=[];
    for(let edge=0;edge<3;edge++) {
      const a=mesh.indices[tri+edge]*3,b=mesh.indices[tri+(edge+1)%3]*3;
      const ay=mesh.positions[a+1],by=mesh.positions[b+1];
      if((ay<=cut&&by>cut)||(by<=cut&&ay>cut)) {
        const t=(cut-ay)/(by-ay);
        xs.push(mesh.positions[a]+(mesh.positions[b]-mesh.positions[a])*t);
      }
    }
    if(xs.length===0)continue;
    const lo=Math.min(...xs),hi=Math.max(...xs);
    leftSupport ||= lo<0;rightSupport ||= hi>0;centralSupport ||= lo<=0&&hi>=0;
  }
  check(leftSupport&&rightSupport&&!centralSupport,'human shin cross-section is not two separated supports');
  check(Math.abs(mesh.boundsMin[1])<1e-6&&Math.abs(mesh.boundsMax[1]-PEDESTRIAN_HEIGHT)<1e-6,'human mesh does not span shared floor/height');
  console.log(`  human mesh radial extent ${maxRadius.toFixed(6)}m, radius limit ${PEDESTRIAN_RADIUS}m, height ${mesh.boundsMax[1]}m; shin center ${centralSupport?'blocked':'open'}`);
}

function instanceIsolation():void {
  const sim=new CrowdSim(7),state=raw(sim),data=sim.instances.data;
  const capacity=state.f.length/STRIDE;
  check(data.length===capacity*INSTANCE_FLOATS,'instance storage is not exactly capacity times ABI stride');
  data.fill(123.456);
  for(const slot of [2,0,capacity-1,3,1]) {
    const o=slot*STRIDE;
    state.f[o]=slot+.125;state.f[o+1]=GROUND_Y;state.f[o+2]=-slot-.25;
    state.f[o+5]=slot*.127;state.f[o+6]=slot*.37;state.f[o+18]=3;state.f[o+7]=1.2;
    const before=data.slice();
    state.writeInstance(slot,o);
    const start=slot*INSTANCE_FLOATS,end=start+INSTANCE_FLOATS;
    let isolated=true,finite=true;
    for(let i=0;i<data.length;i++) {
      if(i<start||i>=end) { if(data[i]!==before[i])isolated=false; }
      else if(!Number.isFinite(data[i]))finite=false;
    }
    check(isolated,`writing instance ${slot} changes another record`);
    check(finite&&data[start+12]===state.f[o]&&data[start+14]===state.f[o+2],`instance ${slot} does not carry its own finite transform`);
    const det=data[start]*(data[start+5]*data[start+10]-data[start+6]*data[start+9])
      -data[start+4]*(data[start+1]*data[start+10]-data[start+2]*data[start+9])
      +data[start+8]*(data[start+1]*data[start+6]-data[start+2]*data[start+5]);
    check(Math.abs(det-1)<1e-6,`instance ${slot} rotation basis collapses`);
  }
}

/** The pavement hold reuses a street frame until the agent moves 0.5 m; it must
 *  agree with an exact sample at the agent's current position, and be reused. */
function holdCacheProperty():void {
  const seed=6191639,sim=new CrowdSim(seed),world=defaultWorld(seed);
  sim.attach(new City(defaultCityConfig(seed)),seed);
  const camera={position:[107.06,1.95,-405.96] as [number,number,number],lookAt:[113.14,1.95,-426.94] as [number,number,number]};
  for(let k=0;k<240;k++)sim.update(1/60,camera,world);
  const st=sim as unknown as {f:Float32Array;holdCache:Float32Array};
  const plan=cityPlan(seed),out={dist:0,px:0,pz:0,tx:1,tz:0,width:1,kind:'street',clearance:0} as StreetSample;
  const errs:number[]=[];let reused=0;
  for(let i=0;i*STRIDE<st.f.length;i++){
    const o=i*STRIDE,c=i*6;
    if(st.f[o+ACTIVE]<.5||st.f[o+28]===0||Number.isNaN(st.holdCache[c]))continue;
    const x=st.f[o],z=st.f[o+2],h=st.holdCache;
    if(h[c]!==x||h[c+1]!==z)reused++;
    const e=sampleStreetPlan(plan,x,z,out);
    const exact=(x-e.px)*-e.tz+(z-e.pz)*e.tx,cached=(x-h[c+2])*-h[c+5]+(z-h[c+3])*h[c+4];
    errs.push(Math.abs(exact-cached));
  }
  errs.sort((a,b)=>a-b);
  const p95=errs[Math.floor(errs.length*.95)]??Infinity;
  check(errs.length>500,'hold cache fixture has too few held agents');
  check(reused>errs.length*.5,'hold cache is not reused between frames');
  check(p95<.05,`cached street frame disagrees with exact sample: p95 ${p95.toFixed(3)} m`);
  console.log(`  hold cache: ${errs.length} held agents, ${reused} on reused frames, lateral error p95 ${p95.toFixed(4)} m`);
}

/** Near the city edge (skyline pose) every agent must hold a goal: goal -1 was
 *  permanent and re-ran the goal search every frame. */
function goalProperty():void {
  const seed=6191639,sim=new CrowdSim(seed),world=defaultWorld(seed);
  sim.attach(new City(defaultCityConfig(seed)),seed);
  const camera={position:[900,120,1400] as [number,number,number],lookAt:[0,200,0] as [number,number,number]};
  for(let k=0;k<240;k++)sim.update(1/60,camera,world);
  const f=raw(sim).f;let active=0,none=0;
  for(let o=0;o<f.length;o+=STRIDE){if(f[o+ACTIVE]<.5)continue;active++;if((f[o+8]|0)<0)none++;}
  check(active>1000,'goal fixture seeded too few agents');
  check(none===0,`${none} of ${active} agents have no goal near the city edge`);
  console.log(`  goals: ${active} active at the skyline pose, ${none} without a goal`);
}

queryProperties();motionProperties();walkingSurfaceProperties(emittedSolids());meshEnvelope();instanceIsolation();holdCacheProperty();goalProperty();
console.log(failures.length?`FAIL (${failures.length})\n${failures.join('\n')}`:'ALL PASS — true nearest, walking support, mesh envelope, body/solid clearance and instance isolation');
if(failures.length)throw new Error('Crowd property regression failed');
