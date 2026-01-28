#!/bin/bash

# Kill background jobs on exit
trap 'kill $(jobs -p)' EXIT

echo "🚀 Starting AVG Anonimiseer (Local Dev)"
echo "----------------------------------------"

# Check if pip dependencies are installed
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment and installing dependencies..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r backend/requirements.txt
else
    source venv/bin/activate
fi

# Start Backend
echo "🤖 Starting Backend (Port 8000)..."
export MISTRAL_API_KEY="RjhyR0eAckefARBT6V2x88nPAIBlk961"
cd backend
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Start Frontend
echo "🌐 Starting Frontend (Port 3000)..."
# Using python http.server as a simple static server
cd frontend
python3 -m http.server 3000 &
FRONTEND_PID=$!
cd ..

echo "----------------------------------------"
echo "✅ Backend running at: http://localhost:8000"
echo "✅ Frontend running at: http://localhost:3000"
echo "----------------------------------------"
echo "Press Ctrl+C to stop servers."

wait
