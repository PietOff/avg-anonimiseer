# Deployment Guide

I've successfully prepared your code and installed the necessary tools. Since I don't have access to your accounts, you need to execute the final deployment steps.

## 1. Backend (Render)

Hosted on Render to run the Python AI Proxy securely.

1. Go to **[Render Dashboard](https://dashboard.render.com/web/new)**.
2. Connect your repository: `PietOff/avg-anonimiseer`.
3. Use these **exact settings**:
   - **Name**: `avg-anonimiseer-backend`
   - **Root Directory**: `backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. **Environment Variables** (Advanced):
   - Key: `MISTRAL_API_KEY`
   - Value: `YOUR_MISTRAL_API_KEY` (Get one at console.mistral.ai)
5. Click **Deploy**.
6. **Copy the URL** when done (e.g., `https://avg-anonimiseer-backend.onrender.com`).

## 2. Frontend (Vercel)

Hosted on Vercel for the user interface.

**Option A: Web Interface**

1. Go to **[Vercel Dashboard](https://vercel.com/new)**.
2. Import `PietOff/avg-anonimiseer`.
3. **Edit Root Directory**: Change it to `frontend`.
4. Click **Deploy**.

**Option B: Command Line (I installed the tool for you!)**

1. Run: `export PATH=$PATH:/opt/homebrew/bin`
2. Run: `vercel login` (Follow browser prompt).
3. Run: `vercel deploy frontend --prod`

## 3. Final Connection

1. Once your **Backend** is live, copy its URL.
2. Edit `frontend/mistral.js` in your project:

   ```javascript
   // line 12
   BACKEND_URL: 'https://YOUR-RENDER-APP-NAME.onrender.com/api/analyze',
   ```

3. Commit and push:

   ```bash
   git add frontend/mistral.js
   git commit -m "Update API URL"
   git push
   ```

4. Vercel will automatically update.
