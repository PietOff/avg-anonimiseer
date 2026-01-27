from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
import os
import httpx
from pydantic import BaseModel

app = FastAPI()

# Configure CORS
origins = [
    "http://localhost:3000",
    "http://localhost:5000",
    "http://127.0.0.1:5500", # Common VS Code Live Server
    "https://avg-anonimiseer.vercel.app", # Adjust if you have a specific domain
    "*" # Allow all for now during dev, tighten later
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")
MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions"
MODEL = "mistral-large-latest"

class AnalyzeRequest(BaseModel):
    text: str

@app.get("/")
def read_root():
    return {"status": "ok", "service": "AVG Anonimiseer Backend"}

@app.post("/api/analyze")
async def analyze_text(request: AnalyzeRequest):
    if not MISTRAL_API_KEY:
        raise HTTPException(status_code=500, detail="Mistral API Key not configured on server.")

    # Truncate request to avoid token limits (conservative limit)
    safe_text = request.text[:15000]

    system_prompt = """
You are a GDPR compliance expert specializing in Dutch personal data anonymization.
Your task is to analyze the provided text and identify Personally Identifiable Information (PII) that needs to be redacted.

Focus specifically on:
1. Names of PERSONS (exclude company names like BV, VOF, Stichting, Gemeente).
2. Phone numbers (mobile and landline).
3. Email addresses.
4. BSN (Burgerservicenummer).
5. IBAN bank accounts.

Do NOT flag:
- Company names, government bodies, or job titles.
- Dates or generalized locations (like city names alone).

Return a JSON object with a single key "found" containing an array of objects.
Each object must have:
- "type": One of ["name", "phone", "email", "bsn", "iban"]
- "value": The exact substring found in the text.
- "confidence": Number between 0 and 1.
    """

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                MISTRAL_API_URL,
                json={
                    "model": MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": safe_text}
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1
                },
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {MISTRAL_API_KEY}"
                },
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
            
            # Extract content
            content = data["choices"][0]["message"]["content"]
            
            # mistral often returns a string json, we need to ensure we return an object 
            # but here we just return the raw JSON structure Mistral gave us content-wise? 
            # No, content is a string. The frontend expects an array of found items.
            import json
            result = json.loads(content)
            return result.get("found", [])

    except httpx.HTTPStatusError as e:
        print(f"Mistral API Error: {e.response.text}")
        raise HTTPException(status_code=502, detail="Error communicating with AI provider.")
    except Exception as e:
        print(f"Server Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
