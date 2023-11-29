git pull origin master
git reset --hard origin master
docker compose down
docker system prune
docker compose up -d --build --force-recreate --always-recreate-deps
