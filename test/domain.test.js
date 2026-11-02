import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaff, isAdmin, validId, clean, statuses } from '../domain.js';
test('access matrix keeps reporters out of staff and administration', () => {
 for (const role of ['reporter', undefined, 'OWNER', 'administrator']) {
  assert.equal(isStaff({role}), false); assert.equal(isAdmin({role}), false);
 }
 assert.equal(isStaff(null), false); assert.equal(isAdmin(null), false);
 assert.equal(isStaff({role:'developer'}),true); assert.equal(isAdmin({role:'developer'}),false);
 for (const role of ['admin','owner']) { assert.equal(isStaff({role}),true); assert.equal(isAdmin({role}),true); }
});
test('resource IDs reject SQL fragments, unsafe integers and nonpositive IDs', () => {
 for (const id of ['1 OR 1=1', '1.1', '-1', '0', '', undefined, '9007199254740992']) assert.equal(validId(id),false);
 for (const id of [1,'42','999999']) assert.equal(validId(id),true);
});
test('text validation rejects missing, oversized and blank required values', () => {
 for (const value of [null,{},3,undefined,'    ','abcd']) assert.throws(()=>clean(value,3,true),{status:400});
 assert.equal(clean(' x ',3,true),'x'); assert.equal(clean('',3),'');
});
test('workflow includes triage, testing, resolution and closure', () => {
 assert.deepEqual(statuses,['open','triaged','in_progress','testing','resolved','closed']);
});
