import{t as e}from"./settings-dropdown-_dSHkmK7.js";/* empty css                           */new class{constructor(){this.mesh2motion_engine=new e}};var t=[{id:`sergei`,name:`Sergei`,color:`#e74c3c`,suggestedRig:`human`,rigNote:`Humanoid gorilla — human rig fits cleanly`},{id:`kurama`,name:`Kurama`,color:`#ff9a5c`,suggestedRig:`fox`,rigNote:`Fox — direct match`},{id:`cheeto`,name:`Cheeto`,color:`#ff6a00`,suggestedRig:`fox`,rigNote:`Tiger — closest is fox (both quadruped felines)`},{id:`kowalski`,name:`Kowalski`,color:`#3b82f6`,suggestedRig:`bird`,rigNote:`Penguin — bird rig (try human if bird feels limited)`},{id:`trunk`,name:`Trunk`,color:`#9a8671`,suggestedRig:`kaiju`,rigNote:`Elephant — kaiju is closest heavy quadruped`},{id:`sebastian`,name:`Sebastian`,color:`#c0392b`,suggestedRig:`spider`,rigNote:`Crab — spider for multi-leg arthropod`},{id:`shelly`,name:`Shelly`,color:`#4ade80`,suggestedRig:`kaiju`,rigNote:`Turtle — no perfect match. Kaiju-ish; may need Tripo Animate instead`},{id:`kermit`,name:`Kermit`,color:`#74c69d`,suggestedRig:`human`,rigNote:`Frog — no native rig. Human is a stretch; Tripo Animate recommended`},{id:`sihans`,name:`Sihans`,color:`#a68b5b`,suggestedRig:`human`,rigNote:`Mole — no native rig. Use Tripo Animate for proper result`}];function n(e){return`models/critters/${e}.glb`}var r=`
#bichitos-roster-panel {
  background: rgba(231, 76, 60, 0.06);
  border: 1px solid rgba(231, 76, 60, 0.35);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 0 0 12px 0;
  font-family: 'Segoe UI', Arial, sans-serif;
  color: inherit;
}
#bichitos-roster-panel h3 {
  margin: 0 0 6px 0;
  font-size: 12px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: #ffbbb2;
  font-weight: 700;
}
#bichitos-roster-panel .subtitle {
  font-size: 10px;
  opacity: 0.7;
  margin-bottom: 10px;
}
#bichitos-roster-panel .critter-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.bichitos-critter-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 8px 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  transition: transform 0.12s, border-color 0.12s, background 0.12s;
  color: inherit;
  font: inherit;
}
.bichitos-critter-card:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 220, 92, 0.55);
  transform: translateY(-1px);
}
.bichitos-critter-card .dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0,0,0,0.45);
}
.bichitos-critter-card .name {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.bichitos-critter-card .rig {
  font-size: 8px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  opacity: 0.65;
}
`;function i(){if(document.getElementById(`bichitos-roster-styles`))return;let e=document.createElement(`style`);e.id=`bichitos-roster-styles`,e.textContent=r,document.head.appendChild(e)}function a(){let e=document.createElement(`div`);e.id=`bichitos-roster-panel`;let n=document.createElement(`h3`);n.textContent=`Bichitos Rumble roster`,e.appendChild(n);let r=document.createElement(`div`);r.className=`subtitle`,r.textContent=`Click a critter to load its GLB and preselect the suggested skeleton.`,e.appendChild(r);let i=document.createElement(`div`);i.className=`critter-grid`;for(let e of t){let t=document.createElement(`button`);t.type=`button`,t.className=`bichitos-critter-card`,t.title=e.rigNote,t.dataset.critterId=e.id;let n=document.createElement(`span`);n.className=`dot`,n.style.background=e.color,t.appendChild(n);let r=document.createElement(`span`);r.className=`name`,r.textContent=e.name,t.appendChild(r);let a=document.createElement(`span`);a.className=`rig`,a.textContent=`→ ${e.suggestedRig}`,t.appendChild(a),t.addEventListener(`click`,()=>{o(e)}),i.appendChild(t)}return e.appendChild(i),e}function o(e){let t=document.querySelector(`#model-selection`),r=document.querySelector(`#load-model-button`);if(!t||!r){console.warn(`[BichitosRosterPicker] mesh2motion DOM not ready yet`);return}let i=n(e.id),a=Array.from(t.options).find(e=>e.value===i);a||(a=document.createElement(`option`),a.value=i,a.textContent=`${e.name} (Bichitos)`,t.appendChild(a)),t.value=i,r.click(),console.log(`[BichitosRosterPicker] loading ${e.name} (${i}), suggested rig: ${e.suggestedRig}`),s(e.suggestedRig)}function s(e){let t=performance.now(),n=()=>{let t=document.querySelector(`#skeleton-selection`);return!t||!Array.from(t.options).map(e=>e.value).includes(e)?!1:(t.value=e,t.dispatchEvent(new Event(`change`,{bubbles:!0})),console.log(`[BichitosRosterPicker] preselected skeleton: ${e}`),!0)},r=()=>{n()||performance.now()-t>8e3||requestAnimationFrame(r)};requestAnimationFrame(r)}function c(){let e=document.getElementById(`load-model-tools`);if(!e){requestAnimationFrame(c);return}if(document.getElementById(`bichitos-roster-panel`))return;i();let t=a();e.parentNode?.insertBefore(t,e),console.log(`[BichitosRosterPicker] mounted`)}document.readyState===`loading`?document.addEventListener(`DOMContentLoaded`,c,{once:!0}):c();
//# sourceMappingURL=create-Ct67Ulrv.js.map