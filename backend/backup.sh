#!/bin/sh

set -eu

echo "========================================"
echo "AgendaPro - Backup automático iniciado"
echo "========================================"

while true
do
    DATA=$(date +%Y-%m-%d_%H-%M-%S)
    ARQUIVO="/backups/agendapro_${DATA}.dump"

    echo "[$(date)] Criando backup: ${ARQUIVO}"

    pg_dump \
        -h postgres \
        -U agendapro \
        -d agendapro \
        -Fc \
        -f "${ARQUIVO}"

    echo "[$(date)] Backup criado com sucesso."

    find /backups \
        -type f \
        -name "agendapro_*.dump" \
        -mtime +7 \
        -delete

    echo "[$(date)] Backups com mais de 7 dias foram removidos."

    echo "[$(date)] Próximo backup em 24 horas."

    sleep 86400
done