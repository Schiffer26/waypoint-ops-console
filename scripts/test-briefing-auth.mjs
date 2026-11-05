import assert from 'node:assert/strict';
import { briefingSnapshot } from '../dist-electron/briefing-data.js';
const now = new Date(2026, 10, 5, 10, 0);
const data = { version:4, state: {
  tasks: [
    {date:'2026-11-05', dueTime:'09:00', completed:false, title:'secret task', description:'secret notes'},
    {date:'2026-11-05', completed:true, title:'done'},
    {date:'2026-11-04', completed:false, title:'older'},
    {date:'2026-11-06', completed:false, title:'future'},
  ],
  events: [
    {date:'2026-11-05', startTime:'11:00', endTime:'12:00', repeat:'none', title:'Visible event', categoryId:'cat', description:'private notes'},
    {date:'2026-11-07', startTime:'11:00', endTime:'12:00', repeat:'none', title:'future secret', categoryId:'cat'},
  ],
  categories: [{id:'cat',code:'OPS',name:'private category name',color:'#fff'}],
  settings: { operatorName:'TEST',hour24:true,theme:'dark',notificationsEnabled:false },
} };
const raw = briefingSnapshot({'waypoint.db.v1':JSON.stringify(data)}, now);
const snapshot = JSON.parse(raw).state;
assert.equal(snapshot.tasks.length, 3);
assert.equal(snapshot.tasks.filter(t => t.date === '2026-11-05').length, 2);
assert.equal(snapshot.events.length, 1);
assert.equal(snapshot.events[0].title, 'Visible event');
assert.equal(snapshot.settings.theme, 'dark');
for (const secret of ['secret task','secret notes','future secret','private category name','notificationsEnabled']) assert(!raw.includes(secret));
assert.equal(briefingSnapshot({}, now), null);
console.log('Briefing read-only minimized snapshot tests passed');
