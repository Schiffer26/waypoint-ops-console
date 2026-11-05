import assert from 'node:assert/strict';
import { briefingBounds } from '../dist-electron/briefing-position.js';
function check(work, main) {
  const b = briefingBounds(work, main);
  assert(b.x >= work.x && b.y >= work.y && b.x + b.width <= work.x + work.width && b.y + b.height <= work.y + work.height, 'briefing stays within work area');
  if (main) {
    const center = main.x + main.width / 2;
    const half = Math.min(250, main.width / 2);
    assert(b.x + b.width <= center - half || b.x >= center + half, 'login panel remains unobstructed');
  }
  return b;
}
assert.deepEqual(check({x:0,y:0,width:1920,height:1080},{x:230,y:80,width:1460,height:920}), {x:1468,y:216,width:452,height:648});
const compact = check({x:0,y:0,width:1366,height:728},{x:0,y:0,width:1366,height:728});
assert(compact.width < 452 && compact.width >= 400);
check({x:-1920,y:40,width:1920,height:1040},{x:-1600,y:100,width:1120,height:800});
check({x:0,y:0,width:800,height:500},{x:0,y:0,width:800,height:500});
check({x:0,y:0,width:3840,height:2100},null);
console.log('Briefing placement: work areas, compact layouts and negative monitor coordinates passed');
