#!/bin/bash

# Find available ports for development services
find_available_port() {
    local start_port=$1
    local port=$start_port

    while [ $port -lt 65535 ]; do
        if ! ss -tuln | grep -q ":$port "; then
            echo $port
            return 0
        fi
        port=$((port + 1))
    done

    echo "No available port found starting from $start_port" >&2
    return 1
}

# Find ports starting from common defaults
POSTGRES_PORT=$(find_available_port 5432)
REDIS_PORT=$(find_available_port 6379)

echo "Available ports found:"
echo "  PostgreSQL: $POSTGRES_PORT"
echo "  Redis: $REDIS_PORT"

# Export for use in docker-compose
export POSTGRES_PORT
export REDIS_PORT

# Create/update .env file for the API
API_ENV_FILE="apps/api/.env"

if [ ! -f "$API_ENV_FILE" ]; then
    cp apps/api/.env.example "$API_ENV_FILE"
fi

# Update DATABASE_URL and REDIS_URL with dynamic ports
sed -i "s|postgresql://cvhub:cvhub_dev_password@localhost:[0-9]*/cvhub|postgresql://cvhub:cvhub_dev_password@localhost:$POSTGRES_PORT/cvhub|g" "$API_ENV_FILE"
sed -i "s|redis://localhost:[0-9]*|redis://localhost:$REDIS_PORT|g" "$API_ENV_FILE"

echo ""
echo "Updated $API_ENV_FILE with:"
echo "  DATABASE_URL=postgresql://cvhub:cvhub_dev_password@localhost:$POSTGRES_PORT/cvhub"
echo "  REDIS_URL=redis://localhost:$REDIS_PORT"

# Output for docker-compose
echo ""
echo "POSTGRES_PORT=$POSTGRES_PORT" > .env.ports
echo "REDIS_PORT=$REDIS_PORT" >> .env.ports
echo "Created .env.ports for docker-compose"
