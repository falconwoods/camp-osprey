#!/bin/bash
set -e

SERVER=app@40.233.114.132
SSH_PORT=22
IMAGE=camposprey-server
CONTAINER=camposprey-server
ENV_FILE=${ENV_FILE:-.env.production}
SERVER_ENV_DIR=/home/app/camposprey-server
HOST_PORT=20001

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing local env file: $ENV_FILE" >&2
  echo "Create it from .env.example, or run with ENV_FILE=/path/to/env npm run deploy." >&2
  exit 1
fi

echo "Building..."
npm run build-image

echo "Uploading $ENV_FILE..."
ssh -p $SSH_PORT $SERVER "mkdir -p $SERVER_ENV_DIR"
scp -P $SSH_PORT "$ENV_FILE" "$SERVER:$SERVER_ENV_DIR/$ENV_FILE"

echo "Deploying to $SERVER..."
docker save $IMAGE:latest | gzip | ssh -p $SSH_PORT $SERVER "
  set -e
  docker load
  if [ ! -f $SERVER_ENV_DIR/$ENV_FILE ]; then
    echo 'Missing env file: $SERVER_ENV_DIR/$ENV_FILE' >&2
    exit 1
  fi
  docker run --rm --env-file $SERVER_ENV_DIR/$ENV_FILE $IMAGE:latest sh -c '
    if [ -z \"\$DATABASE_URL\" ]; then
      echo \"DATABASE_URL is missing from $SERVER_ENV_DIR/$ENV_FILE\" >&2
      exit 1
    fi
    url=\${DATABASE_URL#*://}
    host=\${url#*@}
    host=\${host%%[:/?]*}
    if [ \"\$host\" = localhost ] || [ \"\$host\" = 127.0.0.1 ] || [ \"\$host\" = ::1 ]; then
      echo \"DATABASE_URL points at localhost, which means this app container instead of Postgres.\" >&2
      echo \"Use the infra VPS private IP or another host-reachable database address.\" >&2
      exit 1
    fi
  '
  docker stop $CONTAINER 2>/dev/null || true
  docker rm $CONTAINER 2>/dev/null || true
  docker run -d \
    --name $CONTAINER \
    --env-file $SERVER_ENV_DIR/$ENV_FILE \
    -e PORT=3000 \
    -e HOSTNAME=0.0.0.0 \
    --add-host host.docker.internal:host-gateway \
    --restart unless-stopped \
    -p 127.0.0.1:$HOST_PORT:3000 \
    $IMAGE:latest
"

echo "Done. App running at http://$SERVER:$HOST_PORT"
