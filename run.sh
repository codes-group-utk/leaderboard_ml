cd /home/rohit/Desktop/leaderboard_ml
read -s -p "ADMIN_TOKEN: " LEADERBOARD_ADMIN_TOKEN && echo
export LEADERBOARD_ADMIN_TOKEN
python post_process_and_benchmark/run_challenge_loop.py \
  --api-base "https://leaderboard-api.airfoil-leaderboard.workers.dev" \
  --repo-root "/home/rohit/Desktop/leaderboard_ml" \
  --interval 5m \
  --date-mode fixed \
  --fixed-date "$(date -u +%F)"
