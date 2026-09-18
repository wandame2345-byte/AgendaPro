import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'url';

dotenv.config();
const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../');
const frontend = path.join(root, 'frontend');
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(root, 'uploads'));
fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(frontend));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2,10)}${ext}`;
    cb(null, safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('A foto deve ser JPG, PNG, WEBP ou GIF.'));
  }
});

const asyncHandler = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

function sign(user) {
  return jwt.sign({ id: user.id, role: user.perfil, name: user.nome }, JWT_SECRET, { expiresIn: '8h' });
}
function auth(req,res,next) {
  try {
    const token = req.cookies.agendapro_token;
    if (!token) return res.status(401).json({ error: 'Não autenticado.' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Sessão expirada. Entre novamente.' }); }
}
function requireAdmin(req,res,next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso permitido somente ao administrador.' });
  next();
}
function normalizePhone(v='') { return String(v).trim().replace(/\D/g,''); }
function publicClient(c) {
  return { id:c.id, name:c.nome, phone:c.telefone, photo:c.foto_url, note:c.observacao };
}
function publicAppointment(a) {
  return { id:a.id, name:a.nome, phone:a.telefone, date:a.data, time:String(a.hora).slice(0,5), procedure:a.procedimento, procedureId:a.procedimento_id, price:Number(a.valor), status:a.status, note:a.observacao || '' };
}

app.get('/api/health', asyncHandler(async (_,res)=>{
  await pool.query('SELECT 1');
  res.json({ ok:true, service:'AgendaPro', database:'connected' });
}));

app.post('/api/auth/login', asyncHandler(async (req,res)=>{
  const { email, password, role } = req.body || {};
  const result = await pool.query('SELECT * FROM usuarios WHERE LOWER(email)=LOWER($1) AND perfil=$2 AND ativo=true LIMIT 1',[email,role]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password || '', user.senha_hash))) return res.status(401).json({ error:'E-mail, perfil ou senha incorretos.' });
  res.cookie('agendapro_token', sign(user), { httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production', maxAge:8*60*60*1000 });
  res.json({ user:{ id:user.id, name:user.nome, role:user.perfil } });
}));
app.post('/api/auth/logout',(req,res)=>{ res.clearCookie('agendapro_token',{ httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production' }); res.json({ok:true}); });
app.get('/api/auth/me', auth, (req,res)=>res.json({user:{id:req.user.id,name:req.user.name,role:req.user.role}}));

app.get('/api/procedures', asyncHandler(async (req,res)=>{
  const result=await pool.query('SELECT id,nome,preco,ativo FROM procedimentos WHERE ativo=true ORDER BY nome');
  res.json(result.rows.map(p=>({id:p.id,name:p.nome,price:Number(p.preco)})));
}));
app.post('/api/procedures', auth, requireAdmin, asyncHandler(async(req,res)=>{
  const {name,price}=req.body; if(!String(name||'').trim()) return res.status(400).json({error:'Informe o nome.'});
  const r=await pool.query('INSERT INTO procedimentos(nome,preco) VALUES($1,$2) RETURNING id,nome,preco',[String(name).trim(),Number(price)||0]);
  res.status(201).json({id:r.rows[0].id,name:r.rows[0].nome,price:Number(r.rows[0].preco)});
}));
app.delete('/api/procedures/:id', auth, requireAdmin, asyncHandler(async(req,res)=>{
  await pool.query('UPDATE procedimentos SET ativo=false,updated_at=NOW() WHERE id=$1',[req.params.id]); res.json({ok:true});
}));

app.get('/api/clients', auth, asyncHandler(async(req,res)=>{
  const q=String(req.query.q||'').trim();
  const r=await pool.query(`SELECT c.*, COUNT(a.id)::int AS count, COALESCE(SUM(CASE WHEN a.status <> 'Cancelado' THEN a.valor ELSE 0 END),0) AS total, MAX(a.data) AS last
    FROM clientes c LEFT JOIN agendamentos a ON a.cliente_id=c.id
    WHERE c.ativo=true AND ($1='' OR c.nome ILIKE '%'||$1||'%' OR c.telefone ILIKE '%'||$1||'%')
    GROUP BY c.id ORDER BY MAX(a.data) DESC NULLS LAST,c.nome`,[q]);
  res.json(r.rows.map(c=>({...publicClient(c),count:c.count,total:Number(c.total),last:c.last}))); 
}));
app.post('/api/clients', auth, upload.single('photo'), asyncHandler(async(req,res)=>{
  const name=String(req.body.name||'').trim(), phone=normalizePhone(req.body.phone), note=String(req.body.note||'').trim();
  if(!name||!phone) return res.status(400).json({error:'Nome e telefone são obrigatórios.'});
  const photo=req.file?`/uploads/${req.file.filename}`:null;
  const r=await pool.query(`INSERT INTO clientes(nome,telefone,foto_url,observacao) VALUES($1,$2,$3,$4)
    ON CONFLICT(telefone) DO UPDATE SET nome=EXCLUDED.nome, foto_url=COALESCE(EXCLUDED.foto_url,clientes.foto_url), observacao=EXCLUDED.observacao, ativo=true, updated_at=NOW()
    RETURNING *`,[name,phone,photo,note]);
  res.status(201).json(publicClient(r.rows[0]));
}));
app.delete('/api/clients/:id', auth, asyncHandler(async(req,res)=>{
  const clientId=Number(req.params.id);
  const has=await pool.query('SELECT 1 FROM agendamentos WHERE cliente_id=$1 LIMIT 1',[clientId]);
  if(has.rowCount) return res.status(400).json({error:'Cliente possui histórico de agendamentos e não pode ser excluído. Você pode deixá-lo inativo pelo banco.'});
  await pool.query('UPDATE clientes SET ativo=false,updated_at=NOW() WHERE id=$1',[clientId]); res.json({ok:true});
}));

app.get('/api/appointments', auth, asyncHandler(async(req,res)=>{
  const date=String(req.query.date||'');
  const params=[]; let where='';
  if(date){params.push(date);where='WHERE a.data=$1';}
  const r=await pool.query(`SELECT a.*,c.nome,c.telefone,p.nome AS procedimento FROM agendamentos a JOIN clientes c ON c.id=a.cliente_id JOIN procedimentos p ON p.id=a.procedimento_id ${where} ORDER BY a.data,a.hora`,params);
  res.json(r.rows.map(publicAppointment));
}));

async function upsertClient(client, clientInfo) {
  const name=String(clientInfo.name||'').trim(), phone=normalizePhone(clientInfo.phone), note=String(clientInfo.note||'').trim();
  if(!name||!phone) throw Object.assign(new Error('Nome e telefone são obrigatórios.'),{status:400});
  const photo=clientInfo.photo || null;
  const r=await client.query(`INSERT INTO clientes(nome,telefone,foto_url,observacao) VALUES($1,$2,$3,$4)
    ON CONFLICT(telefone) DO UPDATE SET nome=EXCLUDED.nome,foto_url=COALESCE(EXCLUDED.foto_url,clientes.foto_url),observacao=CASE WHEN EXCLUDED.observacao<>'' THEN EXCLUDED.observacao ELSE clientes.observacao END,ativo=true,updated_at=NOW()
    RETURNING *`,[name,phone,photo,note]);
  return r.rows[0];
}

app.post('/api/appointments', auth, asyncHandler(async(req,res)=>{
  const {name,phone,date,time,procedureId,price,status='Agendado',note=''}=req.body||{};
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const c=await upsertClient(client,{name,phone,note});
    const p=await client.query('SELECT id,nome,preco FROM procedimentos WHERE id=$1 AND ativo=true',[procedureId]);
    if(!p.rowCount) throw Object.assign(new Error('Procedimento inválido.'),{status:400});
    const value=Number(price ?? p.rows[0].preco)||0;
    const r=await client.query(`INSERT INTO agendamentos(cliente_id,procedimento_id,data,hora,valor,status,observacao,criado_por)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[c.id,p.rows[0].id,date,time,value,status,note,req.user.id]);
    await client.query('COMMIT');
    const full=await pool.query(`SELECT a.*,c.nome,c.telefone,p.nome AS procedimento FROM agendamentos a JOIN clientes c ON c.id=a.cliente_id JOIN procedimentos p ON p.id=a.procedimento_id WHERE a.id=$1`,[r.rows[0].id]);
    res.status(201).json(publicAppointment(full.rows[0]));
  } catch(e){ await client.query('ROLLBACK'); if(e.code==='23505') e=Object.assign(new Error('Este horário já está ocupado.'),{status:409}); throw e; } finally { client.release(); }
}));

app.get('/api/public/slots', asyncHandler(async(req,res)=>{
  const date=String(req.query.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error:'Data inválida.'});
  const r=await pool.query("SELECT hora FROM agendamentos WHERE data=$1 AND status <> 'Cancelado'",[date]);
  res.json({date,taken:r.rows.map(x=>String(x.hora).slice(0,5))});
}));

app.post('/api/public/bookings', upload.single('photo'), asyncHandler(async(req,res)=>{
  const {name,phone,date,time,procedureId,note=''}=req.body||{};
  const proc=await pool.query('SELECT id,nome,preco FROM procedimentos WHERE id=$1 AND ativo=true',[procedureId]);
  if(!proc.rowCount) return res.status(400).json({error:'Procedimento inválido.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const c=await upsertClient(client,{name,phone,note,photo:req.file?`/uploads/${req.file.filename}`:null});
    const r=await client.query(`INSERT INTO agendamentos(cliente_id,procedimento_id,data,hora,valor,status,observacao)
      VALUES($1,$2,$3,$4,$5,'Agendado',$6) RETURNING id`,[c.id,proc.rows[0].id,date,time,Number(proc.rows[0].preco)||0,note]);
    await client.query('COMMIT');
    res.status(201).json({ok:true,id:r.rows[0].id,details:`${proc.rows[0].nome} em ${date} às ${String(time).slice(0,5)}.`});
  }catch(e){await client.query('ROLLBACK');if(e.code==='23505')return res.status(409).json({error:'Esse horário acabou de ser ocupado. Escolha outro.'});throw e;}finally{client.release();}
}));

app.patch('/api/appointments/:id/status', auth, asyncHandler(async(req,res)=>{
  const status=req.body?.status;
  if(!['Agendado','Confirmado','Atendido','Cancelado'].includes(status)) return res.status(400).json({error:'Status inválido.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query('UPDATE agendamentos SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[status,req.params.id]);
    if(!r.rowCount) return res.status(404).json({error:'Agendamento não encontrado.'});
    if(status==='Atendido'){
      const a=r.rows[0];
      await client.query(`INSERT INTO atendimentos(agendamento_id,cliente_id,procedimento_id,data,valor,observacao,atendido_por)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT DO NOTHING`,[a.id,a.cliente_id,a.procedimento_id,a.data,a.valor,a.observacao,req.user.id]);
    }
    await client.query('COMMIT');res.json({ok:true});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));

function periodFrom(req){
  const {type='day',date,month,year}=req.query;
  if(type==='month'){const m=month||new Date().toISOString().slice(0,7);return {start:`${m}-01`,end:`${m}-01 + INTERVAL '1 month'`,label:`Mensal — ${m}`};}
  if(type==='year'){const y=Number(year)||new Date().getFullYear();return {start:`${y}-01-01`,end:`${y+1}-01-01`,label:`Anual — ${y}`};}
  const d=date||new Date().toISOString().slice(0,10);return {start:d,end:`${d} + INTERVAL '1 day'`,label:`Diário — ${d}`};
}
async function reportData(type,date,month,year){
  let start,end,label;
  if(type==='month'){month=month||new Date().toISOString().slice(0,7);start=`${month}-01`;const [y,m]=month.split('-').map(Number);end=`${y}-${String(m+1).padStart(2,'0')}-01`;if(m===12)end=`${y+1}-01-01`;label=`Mensal — ${month}`;}
  else if(type==='year'){year=Number(year)||new Date().getFullYear();start=`${year}-01-01`;end=`${year+1}-01-01`;label=`Anual — ${year}`;}
  else {date=date||new Date().toISOString().slice(0,10);start=date;end=new Date(new Date(date+'T00:00:00Z').getTime()+86400000).toISOString().slice(0,10);label=`Diário — ${date}`;}
  const rows=await pool.query(`SELECT a.id,a.data,a.hora,a.valor,a.status,a.observacao,c.nome AS cliente,c.telefone,p.nome AS procedimento,c.observacao AS cliente_observacao
    FROM agendamentos a JOIN clientes c ON c.id=a.cliente_id JOIN procedimentos p ON p.id=a.procedimento_id
    WHERE a.data >= $1 AND a.data < $2 ORDER BY a.data,a.hora`,[start,end]);
  const data=rows.rows.map(x=>({...x,valor:Number(x.valor)}));
  const revenue=data.filter(x=>x.status!=='Cancelado').reduce((s,x)=>s+x.valor,0);
  return {data,revenue,count:data.length,attended:data.filter(x=>x.status==='Atendido').length,canceled:data.filter(x=>x.status==='Cancelado').length,pending:data.filter(x=>!['Atendido','Cancelado'].includes(x.status)).length,ticket:data.length?revenue/data.length:0,label,start,end};
}
app.get('/api/reports/summary', auth, requireAdmin, asyncHandler(async(req,res)=>{
  const today=new Date().toISOString().slice(0,10);
  const month=today.slice(0,7);
  const year=today.slice(0,4);
  const [d,m,y]=await Promise.all([reportData('day',today),reportData('month',null,month),reportData('year',null,null,year)]);
  res.json({today:d,month:m,year:y});
}));
app.get('/api/reports', auth, requireAdmin, asyncHandler(async(req,res)=>res.json(await reportData(req.query.type||'month',req.query.date,req.query.month,req.query.year))));

app.get('/api/reports/pdf', auth, requireAdmin, asyncHandler(async(req,res)=>{
  const r=await reportData(req.query.type||'day',req.query.date,req.query.month,req.query.year);
  const safe=r.label.replace(/[^a-z0-9_-]+/gi,'_');
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="Relatorio_${safe}.pdf"`);
  const doc=new PDFDocument({size:'A4',margin:40});doc.pipe(res);
  doc.fontSize(20).text('AgendaPro');doc.fontSize(10).text('Relatório de atendimentos e faturamento');doc.moveDown();doc.fontSize(13).text(r.label);doc.moveDown();
  doc.fontSize(10).text(`Faturamento: R$ ${r.revenue.toFixed(2).replace('.',',')}`);doc.text(`Registros: ${r.count}`);doc.text(`Atendidos: ${r.attended}`);doc.text(`Pendentes/Agendados: ${r.pending}`);doc.text(`Cancelados: ${r.canceled}`);doc.text(`Ticket médio: R$ ${r.ticket.toFixed(2).replace('.',',')}`);doc.moveDown();
  const map={};for(const a of r.data)map[a.procedimento]=(map[a.procedimento]||0)+1;
  doc.fontSize(13).text('Procedimentos');doc.fontSize(10);for(const [p,n] of Object.entries(map))doc.text(`${p}: ${n} atendimento(s)`);doc.moveDown();doc.fontSize(13).text('Atendimentos das clientes');doc.moveDown(0.5);
  if(!r.data.length)doc.fontSize(10).text('Nenhum atendimento/agendamento encontrado no período.');
  for(let i=0;i<r.data.length;i++){
    const a=r.data[i];
    if(doc.y>700){doc.addPage();}
    doc.fontSize(10).text(`${i+1}. ${a.cliente}`);doc.fontSize(8.5).text(`Data: ${new Date(a.data+'T12:00:00').toLocaleDateString('pt-BR')}  Hora: ${String(a.hora).slice(0,5)}`);doc.text(`Telefone/WhatsApp: ${a.telefone||'-'}`);doc.text(`Procedimento: ${a.procedimento}`);doc.text(`Valor: R$ ${a.valor.toFixed(2).replace('.',',')}  Status: ${a.status}`);doc.text(`Observação: ${a.observacao||a.cliente_observacao||'-'}`);doc.moveDown();
  }
  doc.fontSize(7).text(`Gerado em ${new Date().toLocaleString('pt-BR')}`);doc.end();
}));

app.use((req,res,next)=>{ if(req.path.startsWith('/api/')) return next(); res.sendFile(path.join(frontend,'index.html')); });
app.use((err,req,res,next)=>{console.error(err);const status=err.status||400;res.status(status).json({error:err.message||'Erro interno.'});});

async function ensureSchema(){
  const schema=fs.readFileSync(path.join(__dirname,'../sql/schema.sql'),'utf8'); await pool.query(schema);
}

ensureSchema().then(()=>app.listen(PORT,()=>console.log(`AgendaPro rodando em http://localhost:${PORT}`))).catch(err=>{console.error('Falha ao iniciar:',err);process.exit(1)});
