import cron from 'node-cron';
import { enviarBackupParaGoogleSheets } from './googleBackup.js';

// Função para buscar os agendamentos do seu banco de dados
async function buscarAgendamentosDoBanco() {
  return [
    {
      id: 1005,
      data: new Date().toISOString().split('T')[0],
      horario: '10:00',
      cliente: 'Maria Oliveira',
      telefone: '(85) 98888-7777',
      servico: 'Corte e Escova',
      profissional: 'Ana',
      valor: 90,
      status: 'Concluído'
    }
  ];
}

// Configurado para rodar todos os dias às 23:00
function iniciarAgendamentoBackup() {
  cron.schedule('0 23 * * *', async () => {
    console.log('⏰ Iniciando backup diário automático...');
    try {
      const agendamentos = await buscarAgendamentosDoBanco();
      await enviarBackupParaGoogleSheets(agendamentos);
      console.log('✅ Backup diário concluído com sucesso!');
    } catch (error) {
      console.error('❌ Erro no backup automático:', error);
    }
  });

  console.log('🤖 Agendador de backup configurado para rodar diariamente às 23:00!');
}

export { iniciarAgendamentoBackup };