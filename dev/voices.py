# Renders Mimi's voice clips: every sentence in dev/phrases-<lang>.json, spoken by CosyVoice 3
# (open-source, Apache-2.0) in the voice of a short reference recording. Runs on the family computer;
# nothing is uploaded. Output: voice/<lang>/<id>.m4a + voice/<lang>/index.json (sentence key -> file).
#
#   <cosyvoice venv>/bin/python dev/voices.py --lang zh --cosy ~/SafeSleep/voicegen/cosy \
#       --prompt-wav ~/SafeSleep/voicegen/sunny_prompt.wav --prompt-text "奶奶好，我是Sunny。……"
#
# Safe to stop and rerun: clips that already exist are skipped. Each new clip is transcribed with Whisper
# and re-rendered (up to 6 tries) until it matches its sentence; --check re-checks every existing clip.
import argparse, hashlib, json, os, subprocess, sys, time, difflib

ap = argparse.ArgumentParser()
ap.add_argument('--lang', default='zh')
ap.add_argument('--cosy', required=True)
ap.add_argument('--prompt-wav', required=True)
ap.add_argument('--prompt-text', required=True)
ap.add_argument('--check', action='store_true')
a = ap.parse_args()

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
phrases = json.load(open(os.path.join(root, 'dev', 'phrases-%s.json' % a.lang)))
out = os.path.join(root, 'voice', a.lang)
os.makedirs(out, exist_ok=True)
idx_path = os.path.join(out, 'index.json')
index = json.load(open(idx_path)) if os.path.exists(idx_path) else {}
prompt_wav = os.path.abspath(os.path.expanduser(a.prompt_wav))
fid = lambda key: hashlib.sha1(key.encode()).hexdigest()[:10] + '.m4a'
norm = lambda s: ''.join(ch for ch in s if ch.isalnum())
def sounds(s):
    """Compare by sound: Whisper may answer in traditional characters or pick a homophone (事/是)."""
    if a.lang != 'zh':
        return norm(s).lower()
    from opencc import OpenCC
    from pypinyin import lazy_pinyin
    return ' '.join(lazy_pinyin(norm(OpenCC('t2s').convert(s))))
_match = lambda heard, text: difflib.SequenceMatcher(None, sounds(heard).split(), sounds(text).split()).ratio()
def score(asr, wav, text):
    """Whisper mishears short Chinese clips, so listen twice (with and without the sentence as a hint) and keep
    the better score; a clip the model really garbled fails both ways."""
    best, heard = -1, ''
    for hint in (None, text):
        h = asr.transcribe(wav, language=a.lang, initial_prompt=hint)['text']
        r = max(_match(h, text), _match(h, spoken(text)))  # '1 件' may be heard as '一件'
        if r > best:
            best, heard = r, h
    return best, heard

ZH_NUM = '零一二三四五六七八九十'
def spoken(text):
    """What the model reads: Chinese numerals instead of digits (the model stumbles on '5 件')."""
    if a.lang != 'zh':
        return text
    import re
    def num(n):
        if n <= 10: return ZH_NUM[n]
        if n < 20: return '十' + ZH_NUM[n % 10]
        if n < 100: return ZH_NUM[n // 10] + '十' + (ZH_NUM[n % 10] if n % 10 else '')
        return str(n)
    return re.sub(r'\s*(\d+)\s*', lambda m: num(int(m.group(1))), text)

if a.check:
    import whisper
    m = whisper.load_model('small')
    bad = []
    for p in phrases:
        f = os.path.join(out, fid(p['key']))
        if not os.path.exists(f):
            continue
        r, heard = score(m, f, p['text'])
        print('%.2f  %s  |  %s' % (r, p['text'], heard), flush=True)
        if r < 0.9:
            bad.append(fid(p['key']))
    print('\nlow match (listen, delete and rerun if wrong):', ' '.join(bad) or 'none')
    sys.exit(0)

cosy = os.path.abspath(os.path.expanduser(a.cosy))
os.chdir(cosy)
sys.path[0:0] = [cosy, os.path.join(cosy, 'third_party/Matcha-TTS')]
import torch, torchaudio, whisper
from cosyvoice.cli.cosyvoice import AutoModel
checker = whisper.load_model('small')
model = AutoModel(model_dir='pretrained_models/Fun-CosyVoice3-0.5B')
prompt = 'You are a helpful assistant.<|endofprompt|>' + a.prompt_text

todo = [p for p in phrases if not os.path.exists(os.path.join(out, fid(p['key'])))]
print('%d phrases, %d to render' % (len(phrases), len(todo)), flush=True)
for i, p in enumerate(todo, 1):
    t0 = time.time()
    best, best_r = None, -1
    for attempt in range(6):
        parts = [j['tts_speech'] for j in model.inference_zero_shot(spoken(p['text']), prompt, prompt_wav, stream=False)]
        wav = os.path.join(out, '_try%d.wav' % attempt)
        torchaudio.save(wav, torch.cat(parts, dim=1), model.sample_rate)
        r, heard = score(checker, wav, p['text'])
        print('   try %d: %.2f  %s' % (attempt + 1, r, heard), flush=True)
        if r > best_r:
            best, best_r = wav, r
        if r >= 0.9:
            break
    # trim edge silence, even out loudness, small mono AAC that iPhone and Android both play
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', best, '-af',
                    'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5',
                    '-ac', '1', '-ar', '24000', '-c:a', 'aac', '-b:a', '48k', os.path.join(out, fid(p['key']))], check=True)
    for f in os.listdir(out):
        if f.startswith('_try'):
            os.remove(os.path.join(out, f))
    index[p['key']] = fid(p['key'])
    json.dump(index, open(idx_path, 'w'), ensure_ascii=False, indent=0)
    print('[%d/%d] %.0fs  match %.2f  %s' % (i, len(todo), time.time() - t0, best_r, p['text']), flush=True)
# keep the index in step with the phrase list
keep = {p['key'] for p in phrases}
index = {k: v for k, v in index.items() if k in keep and os.path.exists(os.path.join(out, v))}
json.dump(index, open(idx_path, 'w'), ensure_ascii=False, indent=0)
print('done: %d clips' % len(index))
