const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = v => String(v || '').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const badge = v => '<span class="badge '+esc(v)+'">'+esc(pretty(v))+'</span>';
const date = v => new Date(v).toLocaleString();
let session, projects=[], team=[], routeVersion=0;
const staff = () => ['developer','admin','owner'].includes(session.user?.role);
const admin = () => ['admin','owner'].includes(session.user?.role);
async function api(url, options={}) {
 const multipart = options.body instanceof FormData;
 const res = await fetch('/api'+url, {...options,headers:{...(multipart?{}:{'Content-Type':'application/json'}),'X-CSRF-Token':session?.csrf || '',...options.headers},body:options.body ? multipart ? options.body : JSON.stringify(options.body) : undefined});
 const data = await res.json().catch(()=>({error:'The server returned an invalid response.'}));
 if(!res.ok) { if(res.status===401 && session?.user) {session.user=null; location.hash='#login';} throw Error(data.error || 'Request failed.'); }
 return data;
}
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',4500);}
function options(values,current){return values.map(v=>'<option value="'+esc(typeof v==='object'?v.id:v)+'" '+(String(typeof v==='object'?v.id:v)===String(current)?'selected':'')+'>'+esc(typeof v==='object'?v.name:pretty(v))+'</option>').join('');}
function input(label,name,value='',type='text',required=false,max=180){return '<label>'+esc(label)+'<input type="'+type+'" name="'+name+'" value="'+esc(value)+'" '+(required?'required':'')+' maxlength="'+max+'"></label>';}
function area(label,name,value='',required=false,max=10000){return '<label>'+esc(label)+'<textarea name="'+name+'" '+(required?'required':'')+' maxlength="'+max+'">'+esc(value)+'</textarea></label>';}
function select(label,name,values,value){return '<label>'+esc(label)+'<select name="'+name+'">'+options(values,value)+'</select></label>';}
function bindForm(id,handler){$(id).onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button[type=submit]')||form.querySelector('button');button.disabled=true;form.querySelector('.error')?.remove();try{await handler(Object.fromEntries(new FormData(form)),form);}catch(err){form.insertAdjacentHTML('afterbegin','<div role="alert" class="error">'+esc(err.message)+'</div>');}finally{button.disabled=false;}};}
function header(){
 $('#nav').innerHTML=session.user?'<a href="#dashboard">Overview</a><a href="#bugs">Bug tracker</a><a href="#projects">Projects</a>'+(admin()?'<a href="#users">Administration</a>':'')+'<a href="#account">Account</a><span class="userline">'+esc(session.user.name)+' · '+esc(pretty(session.user.role))+'</span><button class="secondary" id="logout">Sign out</button>':'';
 if($('#logout'))$('#logout').onclick=async()=>{await api('/logout',{method:'POST'});session=await api('/session');location.hash='#login';};
}
function head(title,sub,action=''){return '<div class="page-head"><div><span class="eyebrow">Solaris workspace</span><h1>'+esc(title)+'</h1><p>'+esc(sub)+'</p></div>'+action+'</div>';}
function authView(kind){
 const setup=session.setupRequired,register=kind==='register'&&!setup;
 $('#app').innerHTML='<div class="auth card"><span class="eyebrow">Welcome to SolarisBugs</span><h1>'+(setup?'Create your owner account':register?'Join your workspace':'Sign in to your workspace')+'</h1><p class="muted">'+(setup?'Use the setup key from your server configuration.':'Track issues. Collaborate. Ship with confidence.')+'</p><form id="auth">'+(setup?input('Setup key','setupKey','','password',true,200):'')+(setup||register?input('Full name','name','','text',true,80):'')+input('Email address','email','','email',true,190)+input('Password'+(setup||register?' (12+ characters)':''),'password','','password',true,72)+'<button type="submit">'+(setup?'Create owner account':register?'Create account':'Sign in')+'</button></form>'+(!setup?'<div class="auth-links"><a href="#login">Sign in</a>'+(session.registration?'<a href="#register">Create an account</a>':'')+'</div>':'')+'</div>';
 bindForm('#auth',async data=>{await api(setup?'/setup':register?'/register':'/login',{method:'POST',body:data});session=await api('/session');location.hash='#dashboard';});
}
function bugTable(items){return items.length?'<div class="table-wrap"><table><thead><tr><th>Issue</th><th>Project</th><th>Status</th><th>Priority</th><th>Assigned to</th><th>Updated</th></tr></thead><tbody>'+items.map(b=>'<tr><td class="title"><a href="#bug/'+b.id+'"><small>#'+b.id+'</small> '+esc(b.title)+'</a></td><td>'+esc(b.project_name)+'</td><td>'+badge(b.status)+'</td><td>'+badge(b.priority)+'</td><td>'+esc(b.assignee_name||'Unassigned')+'</td><td class="muted">'+esc(date(b.updated_at))+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty">No issues here yet. Report a bug to get started.</div>';}
async function dashboard(){
 const [stats,list]=await Promise.all([api('/stats'),api('/bugs')]);
 const total=stats.reduce((n,s)=>n+s.count,0),count=fn=>stats.filter(fn).reduce((n,s)=>n+s.count,0);
 $('#app').innerHTML=head('Workspace overview','A clear view of what needs attention.', '<a class="button" href="#new">＋ Report a bug</a>')+'<div class="stats">'+[['Total reports',total],['Active issues',count(s=>!['resolved','closed'].includes(s.status))],['Critical active',count(s=>s.priority==='critical'&&!['resolved','closed'].includes(s.status))],['Resolved / closed',count(s=>['resolved','closed'].includes(s.status))]].map(([label,n])=>'<div class="stat"><small>'+label+'</small><strong>'+n+'</strong></div>').join('')+'</div><div class="grid"><section class="card"><div class="page-head"><h2>Recently updated</h2><a href="#bugs">View all →</a></div>'+bugTable(list.items.slice(0,8))+'</section><aside class="card"><h2>Workflow health</h2><p class="muted">Reports by current status</p>'+session.statuses.map(s=>{const n=count(x=>x.status===s);return '<div class="detail-block"><div class="actions">'+badge(s)+'<span>'+n+'</span></div><progress aria-label="'+esc(pretty(s))+'" class="progress" max="'+Math.max(total,1)+'" value="'+n+'"></progress></div>';}).join('')+'</aside></div>';
}
async function bugList(){
 const params=new URLSearchParams(location.hash.split('?')[1]||'');
 const list=await api('/bugs?'+params);
 $('#app').innerHTML=head('Bug tracker',list.total+' reports match your filters.', '<a class="button" href="#new">＋ Report a bug</a>')+'<section class="card"><form id="filters" class="filters"><input aria-label="Search reports" placeholder="Search title, description or #ID…" name="q" value="'+esc(params.get('q')||'')+'"><select aria-label="Status" name="status"><option value="">All statuses</option>'+options(session.statuses,params.get('status'))+'</select><select aria-label="Priority" name="priority"><option value="">All priorities</option>'+options(session.priorities,params.get('priority'))+'</select><select aria-label="Project" name="project"><option value="">All projects</option>'+options(projects,params.get('project'))+'</select><button type="submit">Filter</button>'+(staff()?'<label><input type="checkbox" name="mine" value="1" '+(params.get('mine')==='1'?'checked':'')+'> Assigned to me</label>':'')+'</form>'+bugTable(list.items)+'<div class="pagination"><button class="secondary" id="prev" '+(list.page<=1?'disabled':'')+'>← Previous</button><small>Page '+list.page+' of '+Math.max(1,list.pages)+'</small><button class="secondary" id="next" '+(list.page>=list.pages?'disabled':'')+'>Next →</button></div></section>';
 $('#filters').onsubmit=e=>{e.preventDefault();location.hash='#bugs?'+new URLSearchParams(new FormData(e.currentTarget));};
 for(const [id,delta] of [['prev',-1],['next',1]])$('#'+id).onclick=()=>{params.set('page',list.page+delta);location.hash='#bugs?'+params;};
}
function newBug(){
 const active=projects.filter(p=>!p.archived);
 $('#app').innerHTML=head('Report a bug','The more detail you share, the faster we can investigate.')+'<section class="card"><form id="new-bug"><div class="two">'+select('Project','project_id',active,'')+input('Affected version','version','','text',false,100)+'</div>'+input('Short, descriptive title','title','','text',true)+area('Description','description','',true,20000)+'<div class="two">'+area('Steps to reproduce','steps')+area('Expected behavior','expected')+'</div>'+area('Actual behavior','actual')+input('Environment / browser / device','environment','','text',false,500)+'<div class="two">'+select('Priority','priority',session.priorities,'medium')+select('Severity','severity',session.severities,'minor')+'</div><p class="muted">Attach screenshots and logs after submitting your report.</p><button type="submit" '+(!active.length?'disabled':'')+'>Submit report</button> <a class="button secondary" href="#bugs">Cancel</a>'+(!active.length?'<p class="muted">An administrator needs to create an active project first.</p>':'')+'</form></section>';
 bindForm('#new-bug',async data=>{const result=await api('/bugs',{method:'POST',body:data});location.hash='#bug/'+result.id;});
}
async function detail(id){
 const {bug:b,comments,attachments,activity}=await api('/bugs/'+id);
 $('#app').innerHTML=head('#'+b.id+' · '+b.title,b.project_name+' · Reported by '+b.reporter_name+' · '+date(b.created_at),'<a class="button secondary" href="#bugs">← All reports</a>')+'<div class="grid"><div><section class="card"><div class="actions">'+badge(b.status)+badge(b.priority)+badge(b.severity)+'</div><br>'+[['Description',b.description],['Steps to reproduce',b.steps],['Expected behavior',b.expected],['Actual behavior',b.actual],['Environment',b.environment],['Version',b.version],['Resolution',b.resolution]].filter(x=>x[1]).map(([title,text])=>'<div class="detail-block"><h3>'+title+'</h3><div class="detail-text">'+esc(text)+'</div></div>').join('')+'</section><section class="card"><h2>Attachments</h2><div class="files">'+attachments.map(a=>'<a href="/api/attachments/'+a.id+'">'+esc(a.filename)+' · '+Math.ceil(a.size/1024)+' KB ↓</a>').join('')+'</div><form id="upload"><label>Screenshot or log<input type="file" name="file" required accept=".png,.jpg,.jpeg,.gif,.webp,.txt,.log,.pdf,.zip"></label><button type="submit" class="secondary">Upload attachment</button></form></section><section class="card"><h2>Discussion</h2>'+comments.map(c=>'<article class="comment '+(c.internal?'internal':'')+'"><strong>'+esc(c.name)+'</strong> <small>'+esc(date(c.created_at))+'</small> '+(c.internal?badge('staff_note'):'')+'<p class="detail-text">'+esc(c.body)+'</p></article>').join('')+'<form id="comment">'+area('Add a comment','body','',true)+(staff()?'<label><input type="checkbox" name="internal"> Private staff note</label>':'')+'<button type="submit">Post comment</button></form></section></div><aside>'+(staff()?'<section class="card"><h2>Issue management</h2><form id="workflow">'+select('Status','status',session.statuses,b.status)+select('Priority','priority',session.priorities,b.priority)+select('Severity','severity',session.severities,b.severity)+select('Assign to','assignee_id',[{id:'',name:'Unassigned'},...team],b.assignee_id||'')+area('Resolution (required to close)','resolution',b.resolution||'')+'<button type="submit">Save changes</button></form></section>':'<section class="card"><h2>Assigned to</h2><p>'+esc(b.assignee_name||'Awaiting assignment')+'</p></section>')+'<section class="card"><h2>Activity history</h2><div class="activity"><strong>'+esc(b.reporter_name)+'</strong> created this report.<br><small>'+esc(date(b.created_at))+'</small></div>'+activity.map(a=>'<div class="activity"><strong>'+esc(a.name)+'</strong><p class="detail-text">'+esc(a.body)+'</p><small>'+esc(date(a.created_at))+'</small></div>').join('')+'</section></aside></div>';
 bindForm('#comment',async data=>{data.internal=data.internal==='on';await api('/bugs/'+id+'/comments',{method:'POST',body:data});await detail(id);});
 bindForm('#upload',async(data,form)=>{await api('/bugs/'+id+'/attachments',{method:'POST',body:new FormData(form)});await detail(id);});
 if(staff())bindForm('#workflow',async data=>{await api('/bugs/'+id,{method:'PATCH',body:data});toast('Issue updated');await detail(id);});
}
async function projectView(){
 $('#app').innerHTML=head('Projects','Organize reports by application or service.')+'<div class="grid"><section class="card"><h2>Your projects</h2>'+projects.map(p=>'<article class="project"><h2><a href="#bugs?project='+p.id+'">'+esc(p.name)+'</a> '+(p.archived?badge('archived'):'')+'</h2><p class="detail-text">'+esc(p.description)+'</p>'+(admin()?'<form class="project-edit" data-id="'+p.id+'">'+input('Name','name',p.name,'text',true,100)+area('Description','description',p.description,false,5000)+'<label><input name="archived" type="checkbox" '+(p.archived?'checked':'')+'> Archived (stops new reports)</label><button type="submit" class="secondary">Save project</button></form>':'')+'</article>').join('')+(!projects.length?'<p class="empty">No projects have been created yet.</p>':'')+'</section>'+(admin()?'<section class="card"><h2>Create a project</h2><form id="project-new">'+input('Project name','name','','text',true,100)+area('Description','description','',false,5000)+'<button type="submit">Create project</button></form></section>':'')+'</div>';
 if(admin()){
 bindForm('#project-new',async data=>{await api('/projects',{method:'POST',body:data});await route();});
 document.querySelectorAll('.project-edit').forEach((form,i)=>{form.id='project-edit-'+i;bindForm('#'+form.id,async data=>{data.archived=data.archived==='on';await api('/projects/'+form.dataset.id,{method:'PATCH',body:data});toast('Project updated');await route();});});
 }
}
async function usersView(){
 const users=await api('/users');
 $('#app').innerHTML=head('Administration','Manage account roles and workspace access.')+'<section class="card"><p class="muted">Reporters see their own reports. Developers work across all projects. Administrators manage projects and reporters/developers. Only the owner can appoint administrators.</p><input id="user-search" placeholder="Filter users by name or email" aria-label="Filter users"><div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Access</th><th>Save</th></tr></thead><tbody>'+users.map(u=>{const locked=u.id===session.user.id||u.role==='owner'||(session.user.role!=='owner'&&u.role==='admin');return '<tr data-search="'+esc((u.name+' '+u.email).toLowerCase())+'"><td><strong>'+esc(u.name)+'</strong><br><small>'+esc(u.email)+'</small></td><td><select aria-label="Role for '+esc(u.name)+'" data-role="'+u.id+'" '+(locked?'disabled':'')+'>'+options(u.role==='owner'?['owner']:session.user.role==='owner'?['reporter','developer','admin']:['reporter','developer'],u.role)+'</select></td><td><label><input type="checkbox" data-active="'+u.id+'" '+(u.active?'checked':'')+' '+(locked?'disabled':'')+'> Active</label></td><td><button data-save="'+u.id+'" '+(locked?'disabled':'')+'>Save</button></td></tr>';}).join('')+'</tbody></table></div></section>';
 $('#user-search').oninput=e=>document.querySelectorAll('[data-search]').forEach(row=>row.hidden=!row.dataset.search.includes(e.target.value.toLowerCase()));
 document.querySelectorAll('[data-save]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const id=button.dataset.save;await api('/users/'+id,{method:'PATCH',body:{role:document.querySelector('[data-role="'+id+'"]').value,active:document.querySelector('[data-active="'+id+'"]').checked}});toast('Access updated');}catch(err){toast(err.message);}finally{button.disabled=false;}});
}
function accountView(){
 $('#app').innerHTML=head('Your account',session.user.name+' · '+session.user.email)+'<section class="card auth"><h2>Change password</h2><form id="password">'+input('Current password','current','','password',true,72)+input('New password (12+ characters)','password','','password',true,72)+'<button type="submit">Update password</button></form></section>';
 bindForm('#password',async data=>{await api('/account/password',{method:'POST',body:data});session=await api('/session');toast('Password updated');accountView();});
}
async function route(){
 const version=++routeVersion;
 try{
 header();
 if(!session.user){authView(location.hash.slice(1));return;}
 projects=await api('/projects');team=staff()?await api('/team'):[];
 if(version!==routeVersion)return;
 const path=location.hash.slice(1).split('?')[0]||'dashboard';
 $('#app').innerHTML='<p class="muted">Loading workspace…</p>';
 if(path==='dashboard'||path==='login'||path==='register')await dashboard();
 else if(path==='bugs')await bugList();
 else if(path==='new')newBug();
 else if(path.startsWith('bug/'))await detail(path.split('/')[1]);
 else if(path==='projects')await projectView();
 else if(path==='users'&&admin())await usersView();
 else if(path==='account')accountView();
 else $('#app').innerHTML='<div class="card"><h1>Page not found</h1><a href="#dashboard">Back to overview</a></div>';
 document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash.slice(1)===path));
 }catch(err){$('#app').innerHTML='<div class="error" role="alert">'+esc(err.message)+'</div><a href="#dashboard">Return to overview</a>';}
}
window.addEventListener('hashchange',route);
(async()=>{try{session=await api('/session');await route();}catch(err){$('#app').innerHTML='<div class="error">'+esc(err.message)+'</div>';}})();
