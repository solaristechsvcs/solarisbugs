import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import config from '../config.js';
const base = 'http://127.0.0.1:' + config.port;
const server = spawn(process.execPath, ['server.js'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', chunk => output += chunk);
server.stderr.on('data', chunk => output += chunk);
function client() {
 let cookie = '', csrf = '';
 return async (url, body, method = body ? 'POST' : 'GET', expected = 200) => {
  const multipart = body instanceof FormData;
  const res = await fetch(base + '/api' + url, { method, headers: {
   Cookie: cookie, 'X-CSRF-Token': csrf, ...(multipart ? {} : {'Content-Type':'application/json'})
  }, body: body ? multipart ? body : JSON.stringify(body) : undefined });
  const setCookie = res.headers.getSetCookie();
  if (setCookie.length) cookie = setCookie[0].split(';')[0];
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text();
  assert.equal(res.status, expected, url + ': ' + JSON.stringify(data));
  if (url === '/session') csrf = data.csrf;
  return data;
 };
}
try {
 let ready = false;
 for (let i=0;i<100;i++) {
  if (server.exitCode !== null) throw Error('Server exited: ' + output);
  try { if ((await fetch(base + '/health')).ok) { ready=true;break; } } catch {}
  await delay(200);
 }
 assert.ok(ready, 'Server did not become healthy: ' + output);
 const owner=client(), reporter=client(), other=client(), developer=client();
 assert.equal((await owner('/session')).setupRequired,true);
 await owner('/setup',{setupKey:'incorrect',name:'Owner',email:'owner@example.com',password:'a-long-owner-password'},'POST',403);
 await owner('/setup',{setupKey:config.setupKey,name:'Owner',email:'owner@example.com',password:'a-long-owner-password'});
 assert.equal((await owner('/session')).user.role,'owner');
 await owner('/setup',{setupKey:config.setupKey,name:'Second',email:'second@example.com',password:'a-long-owner-password'},'POST',409);
 await owner('/projects',{name:'Smoke project',description:'Integration verification'},'POST',201);
 const project=(await owner('/projects'))[0];
 for (const [api,name] of [[reporter,'Reporter'],[other,'Other'],[developer,'Developer']]) {
  await api('/session');
  await api('/register',{name,email:name.toLowerCase()+'@example.com',password:'a-long-test-password'},'POST',201);
  await api('/session');
 }
 const users=await owner('/users'), dev=users.find(u=>u.name==='Developer');
 await owner('/users/'+dev.id,{role:'developer',active:true},'PATCH');
 const bug=await reporter('/bugs',{project_id:project.id,title:'Broken report',description:'Reproducible issue',steps:'Open page',expected:'Page loads',actual:'Error',priority:'high',severity:'major'},'POST',201);
 await other('/bugs/'+bug.id,undefined,'GET',404);
 assert.equal((await other('/bugs')).total,0);
 await reporter('/users',undefined,'GET',403);
 await developer('/users',undefined,'GET',403);
 await reporter('/bugs/'+bug.id,{status:'closed',priority:'low',severity:'minor'},'PATCH',403);
 await developer('/bugs/'+bug.id+'/comments',{body:'Sensitive staff note',internal:true},'POST',201);
 await reporter('/bugs/'+bug.id+'/comments',{body:'Trying a private note',internal:true},'POST',403);
 assert.equal((await reporter('/bugs/'+bug.id)).comments.length,0);
 assert.equal((await developer('/bugs/'+bug.id)).comments[0].body,'Sensitive staff note');
 await reporter('/bugs/'+bug.id+'/comments',{body:'More reproduction details'},'POST',201);
 const form=new FormData();form.append('file',new Blob(['example log'],{type:'text/plain'}),'example.log');
 await reporter('/bugs/'+bug.id+'/attachments',form,'POST',201);
 const attachment=(await reporter('/bugs/'+bug.id)).attachments[0];
 await other('/attachments/'+attachment.id,undefined,'GET',404);
 assert.equal(await reporter('/attachments/'+attachment.id),'example log');
 await developer('/bugs/'+bug.id,{status:'resolved',priority:'high',severity:'major',assignee_id:dev.id,resolution:''},'PATCH',400);
 await developer('/bugs/'+bug.id,{status:'resolved',priority:'high',severity:'major',assignee_id:dev.id,resolution:'Fixed and verified'},'PATCH');
 const resolved=await reporter('/bugs/'+bug.id);
 assert.equal(resolved.bug.status,'resolved');assert.equal(resolved.activity.length,1);
 const badUpload=new FormData();badUpload.append('file',new Blob(['<script>']), 'attack.html');
 await reporter('/bugs/'+bug.id+'/attachments',badUpload,'POST',400);
 const r=users.find(u=>u.name==='Reporter');
 await owner('/users/'+r.id,{role:'reporter',active:false},'PATCH');
 await reporter('/bugs',undefined,'GET',401);
 console.log('Integration checks passed: setup, roles, ownership, private notes, attachments, resolution and account disabling.');
} catch (err) { console.error(output);throw err; }
finally { server.kill('SIGTERM'); }
