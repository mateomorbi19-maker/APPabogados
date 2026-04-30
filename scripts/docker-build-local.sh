#!/bin/bash
# Build local de la imagen Docker leyendo build args desde .env.local.
# Uso: ./scripts/docker-build-local.sh [tag]
# Tag por default: lexstrategy:local

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.local"
TAG="${1:-lexstrategy:local}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Error: .env.local no existe en ${ENV_FILE}" >&2
  exit 1
fi

BUILD_ARGS=()
while IFS= read -r line || [[ -n "${line}" ]]; do
  [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
  if [[ "${line}" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]]; then
    BUILD_ARGS+=(--build-arg "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}")
  fi
done < "${ENV_FILE}"

if [[ ${#BUILD_ARGS[@]} -eq 0 ]]; then
  echo "Error: ${ENV_FILE} no contiene variables válidas" >&2
  exit 1
fi

docker build "${BUILD_ARGS[@]}" -t "${TAG}" "${ROOT_DIR}"
