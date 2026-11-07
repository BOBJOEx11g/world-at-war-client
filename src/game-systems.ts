type R = "money" | "food" | "oil" | "metal" | "manpower" | "gold";
type Wallet = Record<R, number>;
type Branch = "Land Warfare" | "Air Warfare" | "Naval Warfare" | "Industry" | "Electronics" | "Secret Technologies";
type Tech = { id:string; name:string; branch:Branch; description:string; seconds:number; cost:Partial<Wallet>; requires:string[] };
type Building = { id:string; name:string; description:string; seconds:number; cost:Partial<Wallet>; tech:string; unit:string };
type Task = { id:string; endsAt:number };
type State = { wallet:Wallet; researched:string[]; research:Task[]; buildings:Record<string,string[]>; construction:Record<string,Task> };
type Location = { cityId?:string; name?:string };
const KEY = "world-at-war-game-state-v1";
const branches:Branch[] = ["Land Warfare","Air Warfare","Naval Warfare","Industry","Electronics","Secret Technologies"];
const techs:Tech[] = [
{id:"basic-infantry",name:"Basic Infantry",branch:"Land Warfare",description:"Foundations of modern ground forces.",seconds:90,cost:{money:450,metal:120,manpower:80},requires:[]},
{id:"motorization",name:"Motorization",branch:"Land Warfare",description:"Unlocks motorized infantry.",seconds:150,cost:{money:700,oil:250,metal:180},requires:["basic-infantry"]},
{id:"armoured-warfare",name:"Armoured Warfare",branch:"Land Warfare",description:"Unlocks tank production.",seconds:210,cost:{money:1000,oil:400,metal:450},requires:["motorization"]},
{id:"advanced-artillery",name:"Advanced Artillery",branch:"Land Warfare",description:"Improves artillery systems.",seconds:180,cost:{money:800,metal:350},requires:["basic-infantry"]},
{id:"aviation",name:"Aviation",branch:"Air Warfare",description:"Establishes military aviation.",seconds:150,cost:{money:900,oil:350,metal:250},requires:[]},
{id:"fighter-development",name:"Fighter Development",branch:"Air Warfare",description:"Unlocks fighter aircraft.",seconds:210,cost:{money:1100,oil:450,metal:300},requires:["aviation"]},
{id:"strategic-bombing",name:"Strategic Bombing",branch:"Air Warfare",description:"Unlocks long-range bombers.",seconds:240,cost:{money:1300,oil:600,metal:400},requires:["aviation"]},
{id:"naval-engineering",name:"Naval Engineering",branch:"Naval Warfare",description:"Unlocks naval bases and warship construction.",seconds:150,cost:{money:900,metal:350},requires:[]},
{id:"destroyer-doctrine",name:"Destroyer Doctrine",branch:"Naval Warfare",description:"Unlocks destroyers.",seconds:180,cost:{money:1000,oil:300,metal:350},requires:["naval-engineering"]},
{id:"capital-ships",name:"Capital Ships",branch:"Naval Warfare",description:"Unlocks cruisers, battleships and carriers.",seconds:270,cost:{money:1600,oil:650,metal:700},requires:["destroyer-doctrine"]},
{id:"submarine-warfare",name:"Submarine Warfare",branch:"Naval Warfare",description:"Unlocks submarines.",seconds:210,cost:{money:1200,oil:500,metal:400},requires:["naval-engineering"]},
{id:"industrialization",name:"Industrialization",branch:"Industry",description:"Improves national production capacity.",seconds:180,cost:{money:1000,metal:300},requires:[]},
{id:"advanced-industry",name:"Advanced Industry",branch:"Industry",description:"Improves industrial efficiency.",seconds:300,cost:{money:1800,metal:650,oil:250},requires:["industrialization"]},
{id:"communications",name:"Communications",branch:"Electronics",description:"Improves coordination and infrastructure.",seconds:150,cost:{money:850,metal:200},requires:[]},
{id:"radar",name:"Radar",branch:"Electronics",description:"Unlocks radar installations.",seconds:210,cost:{money:1200,metal:400,oil:150},requires:["communications"]},
{id:"experimental-sciences",name:"Experimental Sciences",branch:"Secret Technologies",description:"Opens an independent classified research tree.",seconds:210,cost:{money:1500,metal:450,gold:30},requires:[]},
{id:"advanced-materials",name:"Advanced Materials",branch:"Secret Technologies",description:"Develops materials for classified prototypes.",seconds:300,cost:{money:1900,metal:750,gold:50},requires:["experimental-sciences"]},
{id:"directed-energy",name:"Directed Energy",branch:"Secret Technologies",description:"A late-stage experimental technology.",seconds:420,cost:{money:2800,metal:1000,gold:100},requires:["advanced-materials"]}
];
const buildings:Building[] = [
{id:"barracks",name:"Barracks",description:"Required to recruit infantry.",seconds:90,cost:{money:650,food:250,metal:180},tech:"basic-infantry",unit:"Infantry"},
{id:"tank-plant",name:"Tank Plant",description:"Required to produce tanks.",seconds:180,cost:{money:1300,oil:350,metal:650},tech:"armoured-warfare",unit:"Tanks"},
{id:"aircraft-factory",name:"Aircraft Factory",description:"Required to produce aircraft.",seconds:180,cost:{money:1400,oil:450,metal:550},tech:"aviation",unit:"Aircraft"},
{id:"navy-base",name:"Navy Base",description:"Required to produce naval units.",seconds:210,cost:{money:1500,oil:350,metal:700},tech:"naval-engineering",unit:"Naval units"},
{id:"secret-lab",name:"Secret Lab",description:"Required for classified production.",seconds:240,cost:{money:1800,metal:650,gold:40},tech:"experimental-sciences",unit:"Secret technologies"}
];
const initial:State = {wallet:{money:12000,food:8000,oil:6000,metal:9000,manpower:5000,gold:500},researched:[],research:[],buildings:{},construction:{}};
const keys:R[] = ["money","food","oil","metal","manpower","gold"];
const n=(v:number)=>Math.max(0,Math.floor(v)).toLocaleString();
const left=(t:Task)=>Math.max(0,Math.ceil((t.endsAt-Date.now())/1000));
const duration=(s:number)=>Math.floor(s/60)+"m "+(s%60)+"s";
function load():State {
 try { const x=JSON.parse(localStorage.getItem(KEY)||"null") as Partial<State>|null;
 if(!x?.wallet)return structuredClone(initial);
 const legacyResearch = x.research && !Array.isArray(x.research) ? [x.research as Task] : [];
 return {...initial,...x,wallet:{...initial.wallet,...x.wallet},researched:Array.isArray(x.researched)?x.researched:[],research:Array.isArray(x.research)?x.research:legacyResearch,buildings:x.buildings||{},construction:x.construction||{}};
 } catch { return structuredClone(initial); }
}
export function mountGameSystems():void {
 const sidebar=document.querySelector<HTMLElement>(".sidebar"); if(!sidebar)return;
 let state=load(), city:Location|null=null, branch:Branch="Land Warfare";
 const panel=document.createElement("section"); panel.className="game-systems";
 panel.innerHTML='<div class="section-heading">RESEARCH & DEVELOPMENT <span class="live-label">GLOBAL · 2 SLOTS</span></div><div class="game-card"><div class="game-card-title"><strong>Global research queue</strong><span id="rs-timer" class="game-timer">0 / 2 ACTIVE</span></div><p id="rs-status" class="game-muted">Two technologies can be researched at the same time across the whole world.</p><label class="game-label">Research branch</label><select id="rs-branch" class="game-select"></select><div id="rs-active" class="game-list"></div><div id="rs-list" class="game-list"></div></div><div class="section-heading">CITY CONSTRUCTION <span class="live-label">LOCAL · 1 SLOT / CITY</span></div><div class="game-card"><div id="build-location" class="game-card-title"><strong>No city selected</strong><span class="game-timer">CITY</span></div><p class="game-muted">Select a major city on the map to construct buildings there.</p><div id="build-status" class="game-status">No active construction.</div><div id="build-list" class="game-list"></div></div><div class="section-heading">PRODUCTION REQUIREMENTS</div><div class="game-card"><p class="game-muted">Both research and at least one matching building are required.</p><div id="prod-list" class="game-list"></div></div><p class="game-footnote">Prototype economy: saved in this browser. Timers continue while closed. Starting balances, costs and times are provisional.</p>';
 const selected=sidebar.querySelector("#selection-card"); if(selected?.nextSibling)sidebar.insertBefore(panel,selected.nextSibling);else sidebar.append(panel);
 const branchSelect=panel.querySelector<HTMLSelectElement>("#rs-branch")!;
 const rsList=panel.querySelector<HTMLDivElement>("#rs-list")!;
 const rsStatus=panel.querySelector<HTMLParagraphElement>("#rs-status")!;
 const rsTimer=panel.querySelector<HTMLSpanElement>("#rs-timer")!;
 const buildLocation=panel.querySelector<HTMLElement>("#build-location")!;
 const buildStatus=panel.querySelector<HTMLDivElement>("#build-status")!;
 const buildList=panel.querySelector<HTMLDivElement>("#build-list")!;
 const prodList=panel.querySelector<HTMLDivElement>("#prod-list")!;
 branchSelect.innerHTML=branches.map(b=>'<option value="'+b+'">'+b+'</option>').join("");
 function save(){localStorage.setItem(KEY,JSON.stringify(state));}
 function hasTech(id:string){return state.researched.includes(id);}
 function hasBuilding(id:string){return Object.values(state.buildings).some(list=>list.includes(id));}
 function afford(cost:Partial<Wallet>){return keys.every(k=>state.wallet[k]>=(cost[k]||0));}
 function pay(cost:Partial<Wallet>){keys.forEach(k=>state.wallet[k]-=cost[k]||0);}
 function cost(costs:Partial<Wallet>){return keys.filter(k=>(costs[k]||0)>0).map(k=>k.toUpperCase()+" "+n(costs[k]!)).join(" · ");}
 function refreshTasks():boolean {
  let changed=false;
  if(state.research&&left(state.research)===0){if(!hasTech(state.research.id))state.researched.push(state.research.id);state.research=null;changed=true;}
  Object.entries(state.construction).forEach(([id,task])=>{if(left(task)===0){const list=state.buildings[id]||[];if(!list.includes(task.id))list.push(task.id);state.buildings[id]=list;delete state.construction[id];changed=true;}});
  if(changed)save();
  return changed;
 }
 function renderResearch(){
  const active=state.research;
  rsTimer.textContent=active.length+" / 2 ACTIVE";
  rsStatus.textContent=active.length ? "Global research is running. You can fill the second slot immediately." : "Two global research projects can run at the same time.";
  const activeBox=panel.querySelector<HTMLDivElement>("#rs-active")!;
  activeBox.innerHTML=active.length ? active.map((task,index)=>{
    const tech=techs.find(t=>t.id===task.id);
    return '<article class="game-item is-active"><div class="game-item-main"><strong>Slot '+(index+1)+': '+(tech?.name||task.id)+'</strong><small>'+duration(left(task))+' remaining</small></div><button class="game-speed" data-speed="research" data-research-index="'+index+'">SPEED UP · 1 GOLD / 10s</button></article>';
  }).join("") : '<p class="game-muted">No research is currently active.</p>';
  rsList.innerHTML=techs.filter(t=>t.branch===branch).map(t=>{
   const done=hasTech(t.id), missing=t.requires.filter(id=>!hasTech(id)), alreadyActive=active.some(task=>task.id===t.id), blocked=active.length>=2||alreadyActive||done||missing.length>0;
   const req=missing.map(id=>techs.find(x=>x.id===id)?.name||id).join(", ");
   return '<article class="game-item '+(done?'is-complete':'')+'"><div class="game-item-main"><strong>'+t.name+'</strong><p>'+t.description+'</p><small>'+cost(t.cost)+' · '+duration(t.seconds)+'</small>'+(req?'<small class="game-warning">Requires: '+req+'</small>':'')+'</div><button class="game-action" data-tech="'+t.id+'" '+(blocked||!afford(t.cost)?'disabled':'')+'>'+(done?'DONE':alreadyActive?'ACTIVE':'RESEARCH')+'</button></article>';
  }).join("");
  rsList.querySelectorAll<HTMLButtonElement>("[data-tech]").forEach(btn=>btn.addEventListener("click",()=>{
   const t=techs.find(x=>x.id===btn.dataset.tech);if(!t||state.research.length>=2||state.research.some(task=>task.id===t.id)||hasTech(t.id)||t.requires.some(id=>!hasTech(id))||!afford(t.cost))return;
   pay(t.cost);state.research.push({id:t.id,endsAt:Date.now()+t.seconds*1000});save();render();
  }));
 }
 function renderBuildings(){
  const id=city?.cityId; buildLocation.innerHTML='<strong>'+(city?.name||"No city selected")+'</strong><span class="game-timer">'+(id?"SELECTED":"CITY")+'</span>';
  const active=id?state.construction[id]:null;
  buildStatus.innerHTML='<span id="build-timer">'+(active?"Constructing "+(buildings.find(b=>b.id===active.id)?.name||active.id)+" · "+duration(left(active))+" remaining":id?"No active construction in this city.":"Select a major city node to construct buildings there.")+'</span>'+(active?' <button class="game-speed" data-speed="construction">SPEED UP · 1 GOLD / 10s</button>':"");
  const built=id?state.buildings[id]||[]:[];
  buildList.innerHTML=buildings.map(b=>{
   const done=built.includes(b.id), researched=hasTech(b.tech), activeBuild=!!active;
   const techName=techs.find(t=>t.id===b.tech)?.name||b.tech;
   return '<article class="game-item '+(done?'is-complete':'')+'"><div class="game-item-main"><strong>'+b.name+'</strong><p>'+b.description+'</p><small>'+cost(b.cost)+' · '+duration(b.seconds)+'</small>'+(!researched?'<small class="game-warning">Research first: '+techName+'</small>':'')+(done?'<small class="game-success">Built in this city</small>':'')+'</div><button class="game-action" data-building="'+b.id+'" '+(!id||activeBuild||done||!researched||!afford(b.cost)?'disabled':'')+'>'+(done?'BUILT':'BUILD')+'</button></article>';
  }).join("");
  buildList.querySelectorAll<HTMLButtonElement>("[data-building]").forEach(btn=>btn.addEventListener("click",()=>{
   const b=buildings.find(x=>x.id===btn.dataset.build);if(!b||!id||state.construction[id]||(state.buildings[id]||[]).includes(b.id)||!hasTech(b.tech)||!afford(b.cost))return;
   pay(b.cost);state.construction[id]={id:b.id,endsAt:Date.now()+b.seconds*1000};save();render();
  }));
 }
 function renderProduction(){
  const gates:Array<[string,string,string]>=[["Infantry","basic-infantry","barracks"],["Tanks","armoured-warfare","tank-plant"],["Aircraft","aviation","aircraft-factory"],["Naval units","naval-engineering","navy-base"],["Secret technologies","experimental-sciences","secret-lab"]];
  prodList.innerHTML=gates.map(([name,tech,bld])=>{const research=hasTech(tech),building=hasBuilding(bld),ready=research&&building;return '<div class="production-row"><span>'+name+'</span><strong class="'+(ready?'game-success':'game-warning')+'">'+(ready?'AVAILABLE':'LOCKED')+'</strong><small>'+(research?'Research ✓':'Research —')+' · '+(building?'Building ✓':'Building —')+'</small></div>';}).join("");
 }
 function render(){
  refreshTasks();
  document.querySelectorAll<HTMLElement>(".resource-item").forEach((item,i)=>{const v=item.querySelector("strong");if(v)v.textContent=n(state.wallet[keys[i]!]);});
  renderResearch();renderBuildings();renderProduction();
  panel.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach(btn=>btn.addEventListener("click",()=>{
   if(state.wallet.gold<1)return;
   const kind=btn.dataset.speed;
   if(kind==="research"){
    const index=Number(btn.dataset.researchIndex);
    const task=state.research[index];
    if(!task)return;
    task.endsAt-=10000;
   } else if(kind==="construction"){
    const id=city?.cityId;
    if(!id||!state.construction[id])return;
    state.construction[id]!.endsAt-=10000;
   } else return;
   state.wallet.gold-=1;
   refreshTasks();
   save();
   render();
  }));
 }
 function updateTimers(){
  rsTimer.textContent=state.research.length+" / 2 ACTIVE";
  const id=city?.cityId, task=id?state.construction[id]:null;
  const timer=panel.querySelector<HTMLElement>("#build-timer");
  if(timer)timer.textContent=task?"Constructing "+(buildings.find(b=>b.id===task.id)?.name||task.id)+" · "+duration(left(task))+" remaining":id?"No active construction in this city.":"Select a major city node to construct buildings there.";
  if(id) document.dispatchEvent(new CustomEvent("game-building-state",{detail:{cityId:id,built:state.buildings[id]||[]}}));
 }
 branchSelect.addEventListener("change",()=>{branch=branchSelect.value as Branch;renderResearch();});
 document.addEventListener("game-location-selected",event=>{const d=(event as CustomEvent<Location>).detail;city=d?.cityId?d:null;renderBuildings();});
 document.addEventListener("game-speed-up",event=>{
  const amount=Number((event as CustomEvent<number>).detail);if(!Number.isFinite(amount)||amount<=0||state.wallet.gold<amount)return;
  const ms=amount*10000;
  state.research.forEach(task=>task.endsAt-=ms);
  const id=city?.cityId;if(id&&state.construction[id])state.construction[id]!.endsAt-=ms;
  state.wallet.gold-=amount;
  refreshTasks();save();render();
 });
 document.addEventListener("game-building-state-request",()=>{
  Object.entries(state.buildings).forEach(([cityId,built])=>{
   if(built.length)document.dispatchEvent(new CustomEvent("game-building-state",{detail:{cityId,built}}));
  });
 });
 render();window.setInterval(()=>{if(refreshTasks())render();else updateTimers();},1000);
}
