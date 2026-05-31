#!/bin/bash
set -e

SERVER=app@40.233.114.132
SSH_PORT=22
IMAGE=camposprey-server
CONTAINER=camposprey-server
ENV_FILE=.env
SERVER_ENV_DIR=/home/app/camposprey-server
NETWORK=camposprey-net
HOST_PORT=20001

echo "Building..."
npm run build-image

# echo "Uploading env file..."
# scp -P $SSH_PORT $ENV_FILE $SERVER:$SERVER_ENV_DIR/$ENV_FILE

echo "Deploying to $SERVER..."
docker save $IMAGE:latest | gzip | ssh -p $SSH_PORT $SERVER "
  set -e
  docker load
  if ! docker network inspect $NETWORK >/dev/null 2>&1; then
    docker network create $NETWORK
  fi
  docker stop $CONTAINER 2>/dev/null || true
  docker rm $CONTAINER 2>/dev/null || true
  docker run -d \
    --name $CONTAINER \
    --env-file $SERVER_ENV_DIR/$ENV_FILE \
    -e PORT=3000 \
    -e HOSTNAME=0.0.0.0 \
    --network $NETWORK \
    --restart unless-stopped \
    -p 127.0.0.1:$HOST_PORT:3000 \
    $IMAGE:latest
"

echo "Done. App running at http://$SERVER:$HOST_PORT"
