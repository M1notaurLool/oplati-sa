# Vytiahne JSON vrátený z prehliadača (uložený výsledok nástroja) do súboru.
# Použitie: python3 -I tools/extract-browser-result.py <uložený-výsledok.json> <výstup.json>
import json, sys
src, dst = sys.argv[1], sys.argv[2]
blocks = json.load(open(src, encoding='utf-8'))
text = blocks[0]['text']
payload, _ = json.JSONDecoder().raw_decode(text)   # na začiatku je JSON reťazec, za ním poznámka nástroja
data = json.loads(payload.rstrip()) if isinstance(payload, str) else payload
json.dump(data, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(dst, data.get('source'), len(data.get('offers') or []))
