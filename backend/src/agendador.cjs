// AgendaPro - inicializador do servidor
// O servidor completo está em server.js.
// Este arquivo apenas inicia o server.js para o Render.

(async () => {
  try {
    await import('./server.js');
  } catch (error) {
    console.error('====================================');
    console.error('ERRO AO INICIAR O AGENDAPRO');
    console.error('====================================');
    console.error(error);
    process.exit(1);
  }
})();