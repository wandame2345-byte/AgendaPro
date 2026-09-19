import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

// Configuração para caminhos no ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ID da sua planilha do AgendaPro
const SPREADSHEET_ID = '1eatdp-dIWwqBIHWvE9WuXzVwCJHAknQ4HW5uXagFVmQ';

// Caminho para o ficheiro de credenciais
const KEY_FILE_PATH = path.join(__dirname, '../credentials.json');

async function enviarBackupParaGoogleSheets(agendamentos) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: KEY_FILE_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const valores = agendamentos.map(item => [
      item.id,
      item.data,
      item.horario,
      item.cliente,
      item.telefone,
      item.servico,
      item.profissional,
      item.valor,
      item.status,
      new Date().toLocaleString('pt-BR')
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Página1!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: valores,
      },
    });

    console.log('✅ Backup do AgendaPro enviado com sucesso para o Google Sheets!');
  } catch (error) {
    console.error('❌ Erro ao enviar o backup:', error);
  }
}

export { enviarBackupParaGoogleSheets };