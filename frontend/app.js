const hours=['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00'];
let currentUser=null, procedures=[], clients=[], appointments=[];
const $=id=>document.getElementById(id);
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);
const localDate=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
const fmtDate=s=>{
  if(!s) return '—';
  const d=new Date(String(s).slice(0,10)+'T12:00:00');
  return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR');
};
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
async function api(url,opts={}){const r=await fetch(url,{credentials:'include',...opts});let data=null;try{data=await r.json()}catch{}if(!r.ok)throw new Error(data?.error||'Não foi possível concluir a operação.');return data;}
function formData(obj){const f=new FormData();for(const [k,v] of Object.entries(obj))if(v!==undefined&&v!==null)f.append(k,v);return f;}

function selectRole(role){
 if(role==='cliente'){currentUser={role:'cliente'};enterApp();return}
 pendingRole=role;$('roleSelect').style.display='none';$('loginForm').style.display='block';$('loginRoleLabel').textContent=(role==='admin'?'Entrando como Administrador':'Entrando como Funcionário')+' — '+roleEmail(role);$('loginPassword').value='';$('loginError').textContent='';$('loginPassword').focus();
}
let pendingRole=null;
function backToRoles(){pendingRole=null;$('loginForm').style.display='none';$('roleSelect').style.display='block'}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{const data=await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:roleEmail(pendingRole),password:$('loginPassword').value,role:pendingRole})});currentUser=data.user;enterApp()}catch(err){$('loginError').textContent=err.message}});
function roleEmail(role){return role==='admin'?'admin@agendapro.local':'funcionario@agendapro.local'}
async function logout(){if(currentUser?.role!=='cliente')await api('/api/auth/logout',{method:'POST'}).catch(()=>{});currentUser=null;$('app').style.display='none';$('clientPage').style.display='none';$('authScreen').style.display='flex';backToRoles()}
function enterApp(){ $('authScreen').style.display='none'; if(currentUser.role==='cliente'){ $('app').style.display='none';$('clientPage').style.display='block';initClientPage(); } else {$('clientPage').style.display='none';$('app').style.display='flex';initAdminApp()} }

function navItemsFor(role){return [{id:'dashboard',label:'🏠 Dashboard',roles:['admin','funcionario']},{id:'agenda',label:'📅 Agenda',roles:['admin','funcionario']},{id:'clientes',label:'👥 Clientes',roles:['admin','funcionario']},{id:'procedimentos',label:'🧾 Procedimentos',roles:['admin']},{id:'relatorios',label:'📊 Relatórios',roles:['admin']},{id:'configuracoes',label:'⚙️ Configurações',roles:['admin','funcionario']}].filter(i=>i.roles.includes(role))}
function renderNav(){const items=navItemsFor(currentUser.role);document.querySelector('.nav').innerHTML=items.map(it=>`<button data-section="${it.id}">${it.label}</button>`).join('');document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>showSection(b.dataset.section));$('userTag').textContent=currentUser.role==='admin'?'👑 Administrador':'👤 Funcionário';showSection(items[0].id)}
function showSection(id){const allowed=navItemsFor(currentUser.role).map(i=>i.id);if(!allowed.includes(id))id=allowed[0];document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));$(id).classList.add('active');document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.section===id));renderAll()}
async function initAdminApp(){renderNav();$('agendaDate').value=localDate();$('date').value=localDate();fillTimes();$('reportDay').value=localDate();$('reportMonth').value=localDate().slice(0,7);const y=new Date().getFullYear();$('reportYear').innerHTML=Array.from({length:7},(_,i)=>`<option>${y-3+i}</option>`).join('');$('reportYear').value=y;await refreshData()}
async function refreshData(){try{[procedures,clients,appointments]=await Promise.all([api('/api/procedures'),api('/api/clients'),api('/api/appointments')]);fillAllProcedureSelects();renderAll()}catch(e){alert(e.message);if(/sessão|autentic/i.test(e.message))logout()}}
function fillTimes(){$('time').innerHTML='<option value="">Selecione</option>'+hours.map(h=>`<option>${h}</option>`).join('')}
function openModal(date=localDate(),time=''){$('modal').classList.add('show');$('date').value=date;$('time').value=time;fillAllProcedureSelects()}
function closeModal(){$('modal').classList.remove('show');$('appointmentForm').reset();$('date').value=localDate()}
$('appointmentForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/appointments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('name').value.trim(),phone:$('phone').value.trim(),date:$('date').value,time:$('time').value,procedureId:$('procedure').value,price:Number($('price').value),status:$('status').value,note:$('note').value.trim()})});closeModal();await refreshData();alert('Agendamento salvo com sucesso!')}catch(err){alert(err.message)}});
$('procedure').addEventListener('change',e=>{const p=procedures.find(x=>String(x.id)===String(e.target.value));if(p)$('price').value=p.price});
if($('phone')) $('phone').addEventListener('input',()=>{$('phone').value=$('phone').value.replace(/\D/g,'')});
function fillProcedureSelect(el,withPrice=false){if(!el)return;el.innerHTML='<option value="">Selecione</option>'+procedures.map(p=>`<option value="${p.id}" data-price="${p.price}">${esc(p.name)}${withPrice?` — ${money(p.price)}`:''}</option>`).join('')}
function fillAllProcedureSelects(){fillProcedureSelect($('procedure'),false);fillProcedureSelect($('clientProcedure'),true)}
function renderAll(){renderDashboard();renderAgenda();renderClients();if(currentUser?.role==='admin'){renderReports();renderProcedures()}}
function validSales(a){return a.status!=='Cancelado'}
function periodTotals(start,end){const x=appointments.filter(a=>validSales(a)&&a.date>=start&&a.date<=end);return {revenue:x.reduce((s,a)=>s+Number(a.price),0),count:x.length}}
function startWeek(d){let x=new Date(d+'T12:00:00'),day=x.getDay();x.setDate(x.getDate()-(day===0?6:day-1));return x.toISOString().slice(0,10)}
function endWeek(d){let x=new Date(startWeek(d)+'T12:00:00');x.setDate(x.getDate()+6);return x.toISOString().slice(0,10)}
function renderDashboard(){const t=localDate(),w=periodTotals(startWeek(t),endWeek(t)),m=periodTotals(t.slice(0,7)+'-01',new Date(new Date(t+'T12:00:00').getFullYear(),new Date(t+'T12:00:00').getMonth()+1,0).toISOString().slice(0,10)),day=periodTotals(t,t);$('todayLabel').textContent=new Date(t+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});$('todayRevenue').textContent=money(day.revenue);$('todayCount').textContent=`${day.count} atendimento(s)`;$('weekRevenue').textContent=money(w.revenue);$('weekCount').textContent=`${w.count} atendimento(s)`;$('monthRevenue').textContent=money(m.revenue);$('monthCount').textContent=`${m.count} atendimento(s)`;$('freeCount').textContent=hours.filter(h=>!appointments.some(a=>a.date===t&&a.time===h&&a.status!=='Cancelado')).length;const upcoming=appointments.filter(a=>a.date>=t&&a.status!=='Cancelado').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).slice(0,7);$('nextAppointments').innerHTML=upcoming.length?`<div class="table-wrap"><table><tr><th>Data</th><th>Hora</th><th>Cliente</th><th>Valor</th><th>Ações</th></tr>${upcoming.map(a=>`<tr><td>${fmtDate(a.date)}</td><td>${a.time}</td><td><b>${esc(a.name)}</b><br><small>${esc(a.procedure)}</small></td><td>${money(a.price)}</td><td><button type="button" class="btn secondary btn-sm" onclick="showAppointmentDetails(${a.id})">Ver detalhes</button></td></tr>`).join('')}</table></div>`:'<div class="empty">Nenhum próximo atendimento.</div>';const att=m.count,avg=att?m.revenue/att:0;$('monthSummary').innerHTML=`<p><b>${att}</b> atendimento(s) no mês</p><p>Ticket médio: <b>${money(avg)}</b></p><p>Faturamento: <b>${money(m.revenue)}</b></p>`;const isAdmin=currentUser.role==='admin';$('monthCardWrap').style.display=isAdmin?'':'none';$('monthSummaryPanel').style.display=isAdmin?'':'none';$('dashCards').classList.toggle('cols-3',!isAdmin)}
function showAppointmentDetails(id){
 const a=appointments.find(x=>x.id===id);
 if(!a) return alert('Atendimento não encontrado.');
 alert(
   `Cliente: ${a.name}\n`+
   `Telefone: ${a.phone}\n`+
   `Data: ${fmtDate(a.date)}\n`+
   `Horário: ${a.time}\n`+
   `Procedimento: ${a.procedure}\n`+
   `Valor: ${money(a.price)}\n`+
   `Status: ${a.status}\n`+
   `Observação: ${a.note||'-'}`
 );
}
function setStatus(id,newStatus){api(`/api/appointments/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:newStatus})}).then(refreshData).catch(e=>alert(e.message))}
function renderAgenda(){const d=$('agendaDate').value||localDate(),list=appointments.filter(a=>a.date===d).sort((a,b)=>a.time.localeCompare(b.time));$('slots').innerHTML=hours.map(h=>{const a=list.find(x=>x.time===h&&x.status!=='Cancelado');return a?`<div class="slot busy"><strong>${h}</strong>${esc(a.name)}<small>${esc(a.procedure)} • ${money(a.price)}</small></div>`:`<div class="slot free" onclick="openModal('${d}','${h}')"><strong>${h}</strong>Disponível<small>Clique para agendar</small></div>`}).join('');$('dayTable').innerHTML=list.length?`<table><tr><th>Hora</th><th>Cliente</th><th>Foto</th><th>Procedimento</th><th>Valor</th><th>Status</th><th>Obs.</th><th>Ações</th></tr>${list.map(a=>{const c=clients.find(x=>x.phone===a.phone);return `<tr><td><b>${a.time}</b></td><td>${esc(a.name)}<br><small>${esc(a.phone)}</small></td><td>${c?.photo?`<img src="${esc(c.photo)}" class="client-photo">`:'<small style="color:var(--muted)">Sem foto</small>'}</td><td>${esc(a.procedure)}</td><td>${money(a.price)}</td><td><span class="badge ${badge(a.status)}">${a.status}</span></td><td>${esc(a.note||'-')}</td><td><button type="button" class="btn success btn-sm" onclick="setStatus(${a.id},'Atendido')">Concluído</button><button type="button" class="btn danger btn-sm" onclick="setStatus(${a.id},'Cancelado')">Não Concluído</button></td></tr>`}).join('')}</table>`:'<div class="empty">Nenhum agendamento para esta data.</div>'}
function badge(s){return {'Agendado':'b-agendado','Confirmado':'b-confirmado','Atendido':'b-atendido','Cancelado':'b-cancelado'}[s]||'b-agendado'}
function changeDay(n){let d=new Date(($('agendaDate').value||localDate())+'T12:00:00');d.setDate(d.getDate()+n);$('agendaDate').value=d.toISOString().slice(0,10);renderAgenda()}
function goToday(){$('agendaDate').value=localDate();renderAgenda()}
function openClientModal(){$('clientModal').classList.add('show')}
function closeClientModal(){$('clientModal').classList.remove('show');$('clientForm').reset();$('photoPreview').style.display='none';$('photoPreview').src=''}
$('clientPhoto').addEventListener('change',()=>{const f=$('clientPhoto').files[0];if(!f)return;const r=new FileReader();r.onload=e=>{$('photoPreview').src=e.target.result;$('photoPreview').style.display='block'};r.readAsDataURL(f)})
if($('clientPhone')) $('clientPhone').addEventListener('input',()=>{$('clientPhone').value=$('clientPhone').value.replace(/\D/g,'')});
$('clientForm').addEventListener('submit',async e=>{e.preventDefault();try{const f=new FormData();f.append('name',$('clientName').value.trim());f.append('phone',$('clientPhone').value.trim());f.append('note',$('clientNote').value.trim());if($('clientPhoto').files[0])f.append('photo',$('clientPhoto').files[0]);await api('/api/clients',{method:'POST',body:f});closeClientModal();await refreshData();alert('Cliente salvo com sucesso!')}catch(err){alert(err.message)}})
function renderClients(){const q=($('clientSearch').value||'').toLowerCase();const cs=clients.filter(c=>(c.name+c.phone).toLowerCase().includes(q));$('clientTable').innerHTML=cs.length?`<table><tr><th>Cliente</th><th>Contato</th><th>Atendimentos</th><th>Total</th><th>Último atendimento</th><th>Observação</th><th>Ações</th></tr>${cs.map(c=>`<tr><td>${c.photo?`<img class="client-photo" src="${esc(c.photo)}">`:''}<b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td><td>${c.count}</td><td>${money(c.total)}</td><td>${c.last?fmtDate(c.last):'—'}</td><td>${esc(c.note||'-')}</td><td><button type="button" class="btn danger btn-sm" onclick="removeClient(${c.id})">Remover</button></td></tr>`).join('')}</table>`:'<div class="empty">Nenhum cliente encontrado.</div>'}
function removeClient(id){if(!confirm('Tem certeza de que deseja remover este cliente?'))return;api(`/api/clients/${id}`,{method:'DELETE'}).then(refreshData).catch(e=>alert(e.message))}
async function addProcedure(){const name=$('procName').value.trim(),price=Number($('procPrice').value)||0;if(!name)return alert('Informe o nome do procedimento.');try{await api('/api/procedures',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,price})});$('procName').value='';$('procPrice').value='';await refreshData()}catch(e){alert(e.message)}}
function removeProcedure(id){if(!confirm('Remover este procedimento?'))return;api(`/api/procedures/${id}`,{method:'DELETE'}).then(refreshData).catch(e=>alert(e.message))}
function renderProcedures(){$('procedureTable').innerHTML=procedures.length?`<table><tr><th>Procedimento</th><th>Valor padrão</th><th></th></tr>${procedures.map(p=>`<tr><td>${esc(p.name)}</td><td>${money(p.price)}</td><td><button type="button" class="btn secondary" onclick="removeProcedure(${p.id})">Remover</button></td></tr>`).join('')}</table>`:'<div class="empty">Nenhum procedimento cadastrado.</div>'}
function periodArgs(){const type=$('reportPeriod').value;if(type==='day')return {type,date:$('reportDay').value||localDate()};if(type==='month')return {type,month:$('reportMonth').value||localDate().slice(0,7)};return {type,year:$('reportYear').value||new Date().getFullYear()}}
async function renderReports(){if(currentUser?.role!=='admin')return;try{const s=await api('/api/reports/summary');$('rToday').textContent=money(s.today.revenue);$('rMonth').textContent=money(s.month.revenue);$('rYear').textContent=money(s.year.revenue);const args=periodArgs();$('reportDay').style.display=args.type==='day'?'inline-block':'none';$('reportMonth').style.display=args.type==='month'?'inline-block':'none';$('reportYear').style.display=args.type==='year'?'inline-block':'none';const qs=new URLSearchParams(args);const r=await api('/api/reports?'+qs.toString());$('filteredRevenue').textContent=money(r.revenue);$('filteredCount').textContent=r.count;$('filteredTicket').textContent=money(r.ticket);const map={};r.data.forEach(a=>map[a.procedimento]=(map[a.procedimento]||0)+1);const rows=Object.entries(map).sort((a,b)=>b[1]-a[1]),max=rows[0]?.[1]||1;$('procedureReport').innerHTML=`<p style="color:var(--muted)">Período: <b>${esc(r.label)}</b></p>`+(rows.length?rows.map(([p,n])=>`<div style="margin:14px 0"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>${esc(p)}</span><b>${n}</b></div><div class="bar"><i style="width:${n/max*100}%"></i></div></div>`).join(''):'<div class="empty">Não há atendimentos no período selecionado.</div>')}catch(e){console.error(e)}}
async function downloadReportPDF(type){try{let args={type};if(type==='day')args.date=localDate();if(type==='month')args.month=$('reportMonth').value||localDate().slice(0,7);if(type==='year')args.year=$('reportYear').value||new Date().getFullYear();const r=await fetch('/api/reports/pdf?'+new URLSearchParams(args),{credentials:'include'});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'Não foi possível gerar o PDF.')}const blob=await r.blob();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Relatorio_${type}.pdf`;a.click();URL.revokeObjectURL(url)}catch(e){alert(e.message)}}

/* =========================
   ALTERAR SENHA
   ========================= */

async function changePassword(e){
 e.preventDefault();

 const currentPassword=$('currentPassword').value;
 const newPassword=$('newPassword').value;
 const confirmPassword=$('confirmPassword').value;
 const message=$('passwordMessage');

 message.textContent='';
 message.style.color='var(--danger)';

 if(!currentPassword||!newPassword||!confirmPassword){
   message.textContent='Preencha todos os campos.';
   return;
 }

 if(newPassword!==confirmPassword){
   message.textContent='A nova senha e a confirmação não são iguais.';
   return;
 }

 if(newPassword.length<6){
   message.textContent='A nova senha deve ter pelo menos 6 caracteres.';
   return;
 }

 if(currentPassword===newPassword){
   message.textContent='A nova senha deve ser diferente da senha atual.';
   return;
 }

 try{
   const result=await api('/api/auth/password',{
     method:'PUT',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({
       currentPassword,
       newPassword,
       confirmPassword
     })
   });

   message.style.color='var(--success)';
   message.textContent=result.message||'Senha alterada com sucesso!';
   $('passwordForm').reset();

 }catch(err){
   message.style.color='var(--danger)';
   message.textContent=err.message;
 }
}

function clearPasswordForm(){
 $('passwordForm').reset();
 $('passwordMessage').textContent='';
}

let selectedSlot='';

async function initClientPage(){try{procedures=await api('/api/procedures')}catch(e){alert(e.message);return}$('clientBookingForm').reset();$('cbPhotoPreview').style.display='none';$('clientStepForm').style.display='block';$('clientSuccess').style.display='none';$('cbDate').value=localDate();fillProcedureSelect($('clientProcedure'),true);selectedSlot='';renderClientSlots()}
$('cbDate').addEventListener('change',renderClientSlots)
async function renderClientSlots(){const d=$('cbDate').value||localDate();try{const data=await api('/api/public/slots?date='+encodeURIComponent(d));const taken=new Set(data.taken || []);selectedSlot='';$('cbSlots').innerHTML=hours.map(h=>taken.has(h)?`<div class="slot busy"><strong>${h}</strong>Ocupado</div>`:`<div class="slot free" data-time="${h}" onclick="pickSlot('${h}')"><strong>${h}</strong>Disponível</div>`).join('')}catch(e){alert(e.message)}}
function pickSlot(h){selectedSlot=h;document.querySelectorAll('#cbSlots .slot').forEach(el=>el.classList.remove('selected'));document.querySelector(`#cbSlots .slot[data-time="${h}"]`)?.classList.add('selected')}
$('cbPhoto').addEventListener('change',()=>{const f=$('cbPhoto').files[0];if(!f)return;const r=new FileReader();r.onload=e=>{$('cbPhotoPreview').src=e.target.result;$('cbPhotoPreview').style.display='block'};r.readAsDataURL(f)})
$('cbPhone').addEventListener('input',()=>{$('cbPhone').value=$('cbPhone').value.replace(/\D/g,'')});
$('clientBookingForm').addEventListener('submit',async e=>{e.preventDefault();if(!selectedSlot)return alert('Escolha um horário disponível.');try{const f=new FormData();f.append('name',$('cbName').value.trim());f.append('phone',$('cbPhone').value.trim());f.append('date',$('cbDate').value);f.append('time',selectedSlot);f.append('procedureId',$('clientProcedure').value);f.append('note',$('cbNote').value.trim());if($('cbPhoto').files[0])f.append('photo',$('cbPhoto').files[0]);const r=await api('/api/public/bookings',{method:'POST',body:f});$('clientStepForm').style.display='none';$('clientSuccess').style.display='block';$('successDetails').textContent=r.details}catch(err){alert(err.message);renderClientSlots()}})
function newClientBooking(){initClientPage()}

/* =========================
   FORMULÁRIO DE SENHA
   ========================= */

document.addEventListener('DOMContentLoaded',()=>{
 const passwordForm=$('passwordForm');
 if(passwordForm){
   passwordForm.addEventListener('submit',changePassword);
 }
});

async function boot(){try{const data=await api('/api/auth/me');currentUser=data.user;enterApp()}catch{ $('authScreen').style.display='flex' }}
boot();