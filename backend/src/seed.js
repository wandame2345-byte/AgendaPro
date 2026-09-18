import fs from 'fs';import path from 'path';import dotenv from 'dotenv';import bcrypt from 'bcryptjs';import pg from 'pg';import {fileURLToPath} from 'url';
dotenv.config();const {Pool}=pg;const __filename=fileURLToPath(import.meta.url);const __dirname=path.dirname(__filename);const pool=new Pool({connectionString:process.env.DATABASE_URL});
const schema=fs.readFileSync(path.join(__dirname,'../sql/schema.sql'),'utf8');await pool.query(schema);
async function user(nome,email,password,perfil){const hash=await bcrypt.hash(password,12);await pool.query(`INSERT INTO usuarios(nome,email,senha_hash,perfil) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO UPDATE SET nome=EXCLUDED.nome,senha_hash=EXCLUDED.senha_hash,perfil=EXCLUDED.perfil,ativo=true,updated_at=NOW()`,[nome,email,hash,perfil]);}
await user(process.env.ADMIN_NAME||'Administrador',process.env.ADMIN_EMAIL||'admin@agendapro.local',process.env.ADMIN_PASSWORD||'TroqueEssaSenha123!','admin');
await user(process.env.FUNC_NAME||'Funcionário',process.env.FUNC_EMAIL||'funcionario@agendapro.local',process.env.FUNC_PASSWORD||'TroqueEssaSenha456!','funcionario');
const procedures=[['Corte',50],['Escova',40],['Coloração',120],['Manicure',35],['Pedicure',35],['Sobrancelha',25],['Barba',30],['Hidratação',60],['Outro',0]];
for(const [nome,preco] of procedures)await pool.query(`INSERT INTO procedimentos(nome,preco) VALUES($1,$2) ON CONFLICT(nome) DO NOTHING`,[nome,preco]);
console.log('Banco preparado e usuários/procedimentos iniciais criados.');await pool.end();
