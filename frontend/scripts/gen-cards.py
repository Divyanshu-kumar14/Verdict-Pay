"""VerdictPay demo cards: title, end, 12 lower-thirds. Dark stage, teal accent, Noto Sans."""
from PIL import Image, ImageDraw, ImageFont
import os
OUT = os.path.expanduser('~/Videos/verdict-demo/cards')
os.makedirs(OUT, exist_ok=True)
W, H = 1920, 1080
INK = (14, 17, 22, 255)
PAPER = (235, 238, 242, 255)
MUTED = (148, 163, 184, 255)
TEAL = (45, 212, 191, 255)
def font(size, bold=True):
    fam = 'NotoSans-Bold' if bold else 'NotoSans-Regular'
    for p in [f'/usr/share/fonts/noto/{fam}.ttf',
              f'/usr/share/fonts/truetype/noto/{fam}.ttf']:
        try: return ImageFont.truetype(p, size)
        except Exception: pass
    return ImageFont.load_default()
def stage():
    img = Image.new('RGB', (W, H), INK[:3]); d = ImageDraw.Draw(img)
    d.rectangle([0, H-8, W, H], fill=TEAL[:3])
    return img, d
# title
img, d = stage()
f1, f2, f3 = font(92), font(34, False), font(26, False)
d.text((120, 380), 'VerdictPay', font=f1, fill=PAPER[:3])
d.text((120, 500), 'Defend the dispute before the fee attaches.', font=f2, fill=TEAL[:3])
d.text((120, 580), 'Deterministic dispute economics · Gemini-drafted evidence · SHA-256 dossier', font=f3, fill=MUTED[:3])
d.text((120, 980), 'PayPal AI Hackathon · real sandbox orders · no mock on the right', font=font(24, False), fill=MUTED[:3])
img.save(f'{OUT}/title.png')
# end
img, d = stage()
d.text((120, 340), 'Everything you just saw runs.', font=font(72), fill=PAPER[:3])
d.text((120, 460), 'github.com/Divyanshu-kumar14/Verdict-Pay', font=font(36), fill=TEAL[:3])
d.text((120, 530), 'npm install @verdictpay/sdk', font=font(32, False), fill=PAPER[:3])
d.text((120, 620), '26 assertions · real PayPal sandbox orders · MIT licensed', font=font(28, False), fill=MUTED[:3])
d.text((120, 980), 'Clone it · make install · make stack · make web', font=font(26, False), fill=MUTED[:3])
img.save(f'{OUT}/end.png')
caps = [
 '01 · $15 to fight · $30 high-volume',
 '02 · 5 cases · ~$497 exposure · 2.5% ratio',
 '03 · Buyer left · Command center right — nothing mocked',
 '04 · Real sandbox order · CREATED',
 '05 · 4 signed events · chain valid',
 '06 · Break one row → exact sequence reported',
 '07 · Friendly-fraud claim · fact pack locked',
 '08 · Fight -$41.40 · Settle -$99 · Offer -$29.70',
 '09 · Zero-fee deflect · SKIPPED (internal test)',
 '10 · Dossier PDF · re-hash it yourself',
 '11 · 6 cases · $596 · $60 fees avoided',
 '12 · Clone · install · stack · web — 26 assertions green',
]
for i, c in enumerate(caps, 1):
    img = Image.new('RGBA', (W, 120), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rounded_rectangle([60, 10, W-60, 110], radius=18, fill=(10, 13, 18, 215))
    d.rectangle([60, 10, 68, 110], fill=TEAL)
    d.text((96, 38), c, font=font(40), fill=(235, 238, 242, 255))
    img.save(f'{OUT}/cap-{i:02d}.png')
print('cards ok:', sorted(os.listdir(OUT)))
