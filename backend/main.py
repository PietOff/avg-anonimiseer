from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
import os
import httpx
import asyncio
from pydantic import BaseModel

app = FastAPI()

# Configure CORS (Production-ready: no wildcards)
origins = [
    "http://localhost:3000",
    "http://localhost:5000",
    "http://127.0.0.1:5500",  # VS Code Live Server
    "https://avg-anonimiseer.vercel.app",
    "https://avg-anonimiseer-eight.vercel.app",  # Current production URL
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

# Retry configuration
MAX_RETRIES = 3
RETRY_DELAYS = [1, 2, 4]  # Exponential backoff: 1s, 2s, 4s


async def call_mistral_with_retry(client: httpx.AsyncClient, payload: dict, timeout: float = 30.0) -> dict:
    """Call Mistral API with retry logic for rate limiting (429 errors)."""
    last_error = None
    
    for attempt in range(MAX_RETRIES):
        try:
            response = await client.post(
                MISTRAL_API_URL,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {MISTRAL_API_KEY}"
                },
                timeout=timeout
            )
            response.raise_for_status()
            return response.json()
            
        except httpx.HTTPStatusError as e:
            last_error = e
            if e.response.status_code == 429:
                # Rate limited - wait and retry
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAYS[attempt]
                    print(f"⚠️ Rate limited (429). Retrying in {delay}s... (attempt {attempt + 1}/{MAX_RETRIES})")
                    await asyncio.sleep(delay)
                    continue
            # For non-429 errors, raise immediately
            raise
        except httpx.TimeoutException as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAYS[attempt]
                print(f"⚠️ Timeout. Retrying in {delay}s... (attempt {attempt + 1}/{MAX_RETRIES})")
                await asyncio.sleep(delay)
                continue
            raise
    
    # All retries exhausted
    raise last_error

class AnalyzeRequest(BaseModel):
    text: str

@app.get("/")
def read_root():
    return {"status": "ok", "service": "AVG Anonimiseer Backend"}

@app.post("/api/analyze")
async def analyze_text(request: AnalyzeRequest):
    if not MISTRAL_API_KEY:
        # Mock mode for verification without key
        print("⚠️ No API Key found. Returning MOCK data for testing.")
        import asyncio
        await asyncio.sleep(1) # Simulate network delay
        return [
            {"type": "name", "value": "Jan Jansen", "confidence": 0.95},
            {"type": "email", "value": "test@example.com", "confidence": 0.99},
            {"type": "iban", "value": "NL99BANK0123456789", "confidence": 0.98},
            {"type": "iban", "value": "NL99BANK0123456789", "confidence": 0.98},
            {"type": "phone", "value": "06-12345678", "confidence": 0.90},
            {"type": "indicator", "value": "De heer", "confidence": 1.0}
        ]

    # 1. Regex Detection (Fast, deterministic)
    import re
    regex_results = []
    
    # List of signal words (case-insensitive)
    signal_patterns = [
        r"\b(de\s+heer)\b", r"\b(dhr\.?)\b",
        r"\b(mevrouw)\b", r"\b(mw\.?)\b",
        r"\b(veldwerker)\b", r"\b(boormeester)\b",
        r"\b(projectleider)\b", r"\b(adviseur)\b",
        r"\b(contactpersoon)\b"
    ]
    
    for pattern in signal_patterns:
        matches = re.finditer(pattern, request.text, re.IGNORECASE)
        for match in matches:
            regex_results.append({
                "type": "indicator",
                "value": match.group(0), # The actual matched text
                "confidence": 1.0
            })

    # 2. AI Detection (Mistral)
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
            payload = {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": safe_text}
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.1
            }
            data = await call_mistral_with_retry(client, payload, timeout=30.0)
            
            # Extract content
            content = data["choices"][0]["message"]["content"]
            
            import json
            result = json.loads(content)
            mistral_findings = result.get("found", [])
            
            # Merge results
            return regex_results + mistral_findings

    except httpx.HTTPStatusError as e:
        print(f"Mistral API Error: {e.response.text}")
        raise HTTPException(status_code=502, detail="Error communicating with AI provider. Please try again.")
    except Exception as e:
        print(f"Server Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

class AnalyzeImageRequest(BaseModel):
    image: str # Base64 encoded image
    pageNum: int

@app.post("/api/analyze-image")
async def analyze_image(request: AnalyzeImageRequest):
    if not MISTRAL_API_KEY:
        raise HTTPException(status_code=500, detail="Mistral API Key not configured.")

    # Use Pixtral 12B for Vision
    VISION_MODEL = "pixtral-12b-2409" 

    system_prompt = """
    You are a document analysis AI specialized in detecting handwritten signatures.
    
    Analyze this document image and find ALL handwritten signatures and initials (parafen).
    
    COORDINATE SYSTEM:
    - Use normalized coordinates from 0 to 1000
    - Origin (0, 0) is at TOP-LEFT corner of the image
    - X increases to the right, Y increases downward
    - xmin, ymin = top-left corner of signature box
    - xmax, ymax = bottom-right corner of signature box
    
    Return a JSON object:
    {"signatures": [[xmin, ymin, xmax, ymax, confidence], ...]}
    
    Where:
    - xmin, ymin, xmax, ymax: Integers between 0 and 1000
    - confidence: Integer between 0 and 100
    
    DETECT:
    - Handwritten signatures (cursive writing, personal marks)
    - Initials/parafen (short handwritten marks like "JJ" or scribbles)
    - Handwritten dates near signatures
    
    IGNORE:
    - Printed text, logos, stamps
    - Small dots, specks, noise
    - Lines, boxes, or decorative elements
    
    Only include signatures with confidence >= 60.
    If no signatures found, return {"signatures": []}.
    
    ONLY output valid JSON.
    """

    try:
        async with httpx.AsyncClient() as client:
            payload = {
                "model": VISION_MODEL,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": system_prompt},
                            {"type": "image_url", "image_url": {"url": request.image}} 
                        ]
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.1
            }
            data = await call_mistral_with_retry(client, payload, timeout=60.0)
            content = data["choices"][0]["message"]["content"]
            
            import json
            result = json.loads(content)
            return result.get("signatures", [])

    except Exception as e:
        print(f"Vision Error: {str(e)}")
        # Fallback empty list safely
        return []

