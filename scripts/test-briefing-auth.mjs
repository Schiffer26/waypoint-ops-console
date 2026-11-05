import assert from 'node:assert/strict';
import { briefingSnapshot } from '../dist-electron/briefing-data.js';

const key = 'waypoint.db.v1';
const now = new Date(2026, 10, 5, 10, 0);
const data = { version:4, state: {
  tasks: [
    {date:'2026-11-05', dueTime:'09:00', completed:false, title:'task title not shown', description:'secret task notes'},
    {date:'2026-11-05', completed:true, title:'done task'},
    {date:'2026-11-04', completed:false, title:'overdue task'},
    {date:'2026-11-06', completed:false, title:'future task'},
  ],
  events: [
    {id:'one', date:'2026-11-05', startTime:'08:00', endTime:'09:00', repeat:'none', title:'First transmission', categoryId:'cat', description:'private event notes'},
    {id:'two', date:'2026-11-05', startTime:'09:00', endTime:'09:30', repeat:'none', title:'Second transmission', categoryId:'cat'},
    {id:'three', date:'2026-11-05', startTime:'09:30', endTime:'10:01', repeat:'none', title:'Current transmission', categoryId:'cat'},
    {id:'four', date:'2026-11-05', startTime:'10:02', endTime:'11:00', repeat:'none', title:'Next transmission', categoryId:'other'},
    {id:'five', date:'2026-11-05', startTime:'12:00', endTime:'13:00', repeat:'none', title:'Later transmission', categoryId:'other'},
    {id:'future', date:'2026-11-07', startTime:'11:00', endTime:'12:00', repeat:'none', title:'future secret', categoryId:'cat'},
  ],
  categories: [
    {id:'cat',code:'OPS',name:'private category name',color:'#ffffff'},
    {id:'other',code:'HIDDEN',name:'private other category',color:'#000000'},
  ],
  settings: { operatorName:'TEST',hour24:true,theme:'dark',notificationsEnabled:false, privateSetting:'private settings' },
} };
const raw = briefingSnapshot({[key]:JSON.stringify(data)}, now);
const snapshot = JSON.parse(raw).state;

// Briefing task strip uses date, dueTime and completed; no task titles are rendered.
assert.deepEqual(snapshot.tasks.map(({date,dueTime,completed}) => ({date,dueTime,completed})), [
  {date:'2026-11-05', dueTime:'09:00', completed:false},
  {date:'2026-11-05', dueTime:undefined, completed:true},
  {date:'2026-11-04', dueTime:undefined, completed:false},
]);
assert.equal(snapshot.tasks.filter(t => t.date === '2026-11-05').length, 2);
assert.equal(snapshot.tasks.filter(t => t.date === '2026-11-05' && t.completed).length, 1);

// The first three schedule rows need titles, times, and category codes/colors.
assert.equal(snapshot.events.length, 5);
assert.deepEqual(snapshot.events.slice(0,3).map(e => [e.title,e.date,e.startTime,e.endTime,e.categoryId]), [
  ['First transmission','2026-11-05','08:00','09:00','cat'],
  ['Second transmission','2026-11-05','09:00','09:30','cat'],
  ['Current transmission','2026-11-05','09:30','10:01','cat'],
]);
assert.deepEqual(snapshot.categories, [{id:'cat',code:'OPS',color:'#ffffff'}]);
assert.deepEqual(snapshot.settings, {operatorName:'TEST',hour24:true,theme:'dark'});

// When the current event ends before the next five-second refresh, the
// fourth (and fifth) event must retain its title for the next-event panel.
assert.deepEqual(snapshot.events.slice(3).map(e => e.title), ['Next transmission','Later transmission']);
assert(snapshot.events.every(e => e.repeat === 'none'));

// If all today's events have ended, the next future event supplies the
// countdown's displayed title, date and start/end times without private fields.
const afterToday = new Date(2026, 10, 5, 14, 0);
const laterRaw = briefingSnapshot({[key]:JSON.stringify(data)}, afterToday);
const later = JSON.parse(laterRaw).state;
assert.deepEqual(later.events.at(-1), {
  id:'brief-event-5', date:'2026-11-07', startTime:'11:00', endTime:'12:00',
  repeat:'none', title:'future secret', categoryId:'',
});
for (const secret of ['task title not shown','secret task notes','future task','private event notes','private category name','private other category','private settings','notificationsEnabled']) {
  assert(!raw.includes(secret));
  assert(!laterRaw.includes(secret));
}
assert(!raw.includes('future secret'));
// Recurring events still render their concrete date and title in the briefing.
const recurring = {version:4, state:{tasks:[], categories:[{id:'cat',code:'OPS',color:'#fff'}], settings:{operatorName:'TEST',hour24:true,theme:'dark'}, events:[{date:'2026-11-04', startTime:'15:00', endTime:'16:00', repeat:'daily', title:'Recurring briefing event', categoryId:'cat', description:'recurring private note'}]}};
const recurringRaw = briefingSnapshot({[key]:JSON.stringify(recurring)}, now);
const recurringEvent = JSON.parse(recurringRaw).state.events[0];
assert.equal(recurringEvent.date, '2026-11-05');
assert.equal(recurringEvent.title, 'Recurring briefing event');
assert.equal(recurringEvent.categoryId, 'cat');
assert(!recurringRaw.includes('recurring private note'));
assert.equal(briefingSnapshot({}, now), null);
console.log('Briefing field preservation and minimized snapshot tests passed');
