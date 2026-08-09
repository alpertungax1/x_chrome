import urllib.request
import json

API_KEY = "4b2ec005-4a2c-4f10-a5be-a49958d26c8c"
URL = "https://api.sorsa.io/v3/user-tweets"

data = json.dumps({"username": "elonmusk"}).encode("utf-8")
headers = {
    "ApiKey": API_KEY,
    "Content-Type": "application/json"
}

req = urllib.request.Request(URL, data=data, headers=headers, method="POST")

try:
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode("utf-8"))
        tweets = result.get("tweets", [])
        
        print(f"Elon Musk'un son {len(tweets)} tweeti:\n" + "-"*50)
        for i, tweet in enumerate(tweets, 1):
            text = tweet.get("full_text", "").replace("\n", " ")
            likes = tweet.get("likes_count", 0)
            print(f"{i}. [Beğeni: {likes}] {text}")
            
except urllib.error.HTTPError as e:
    print(f"HTTP Hatası: {e.code}")
    print(e.read().decode("utf-8"))
except Exception as e:
    print(f"Hata oluştu: {e}")
