#!/usr/bin/env bash
# Stop the app first (Ctrl+C), then: ./scripts/backup.sh  -> backups/yms-data-<timestamp>.tar.gz . Restore: tar xzf <file> -C services/core
set -e; cd "$(dirname "$0")/.."; mkdir -p backups
f="backups/yms-data-$(date +%Y%m%d-%H%M%S).tar.gz"; tar czf "$f" -C services/core data; echo "Backup written: $f"
