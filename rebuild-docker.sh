git pull origin master
git reset --hard origin master
docker compose down
docker compose up -d --build --force-recreate
